import { Prisma, type SaleCorrectionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addAudit, reference } from "@/lib/records";
import { can } from "@/lib/authz";
import type { Permission } from "@/lib/permissions";
import { HttpError } from "@/lib/http";
import type { SaleCorrectionInput, SaleInput } from "@/lib/validation";
import { movementBalance } from "@/lib/inventory";
import { recordPaymentMovement } from "@/lib/finance";
import { getCustomerAdvanceBalance } from "@/lib/customer-advances";
import { calculateMeasuredSaleQuote } from "@/lib/gold";
import { purchaseFormulaRules } from "@/lib/purchase-formula";

type BatchAllocation = { lotId: string; grams: Prisma.Decimal };
type AdvanceRequestWithRelations = Prisma.CustomerAdvanceRequestGetPayload<{
  include: { advance: true; fulfillments: { select: { grams: true } } };
}>;

export async function postSale(
  user: { id: string; role: Parameters<typeof can>[0]; permissions?: Permission[] },
  input: SaleInput,
  advanceRequestId?: string,
) {
  const quantityKg = new Prisma.Decimal(input.quantityKg);
  const grossGrams = quantityKg.mul(1000);
  const allocationsByLot = new Map<string, Prisma.Decimal>();
  for (const allocation of input.allocations) {
    const grams = new Prisma.Decimal(allocation.grams);
    allocationsByLot.set(allocation.lotId, (allocationsByLot.get(allocation.lotId) ?? new Prisma.Decimal(0)).plus(grams));
  }
  const summedGrams = [...allocationsByLot.values()].reduce((sum, grams) => sum.plus(grams), new Prisma.Decimal(0));
  if (!summedGrams.equals(grossGrams)) throw new HttpError("Selected batch weights must add up exactly to the sale weight", 400);
  if (!grossGrams.isFinite() || grossGrams.decimalPlaces() > 5) throw new HttpError("Sale weight exceeds supported inventory precision", 400);

  const discountAmount = new Prisma.Decimal(input.discountAmount);
  const initialPayment = new Prisma.Decimal(input.initialPayment);
  if (discountAmount.greaterThan(0) && !can(user.role, "trades:discount", user.permissions)) {
    throw new HttpError("You do not have permission to apply a sales discount", 403);
  }

  return prisma.$transaction(async (tx) => {
    let advanceRequest: AdvanceRequestWithRelations | null = null;
    let advanceId: string | null = null;
    const currentBoardPrice = await tx.goldBoardPrice.findFirst({
      where: { priceType: "SELLING", currency: "GHS", priceUnit: "GHS_PER_GRAM_PURE_GOLD", effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (!currentBoardPrice) throw new HttpError("No current compatible GHS gold board price is available", 409);
    if (new Prisma.Decimal(input.pricePerGram).comparedTo(currentBoardPrice.priceAmount) !== 0) {
      throw new HttpError("The selling board price has changed. Refresh the sale form and try again.", 409);
    }
    if (advanceRequestId) {
      advanceRequest = await tx.customerAdvanceRequest.findUnique({
        where: { id: advanceRequestId },
        include: { advance: true, fulfillments: { select: { grams: true } } },
      });
      if (!advanceRequest) throw new HttpError("Customer gold request not found", 404);
      advanceId = advanceRequest.advanceId;
      await tx.$queryRaw`SELECT id FROM CustomerAdvance WHERE id = ${advanceId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM CustomerAdvanceRequest WHERE id = ${advanceRequestId} FOR UPDATE`;
      advanceRequest = await tx.customerAdvanceRequest.findUnique({
        where: { id: advanceRequestId },
        include: { advance: true, fulfillments: { select: { grams: true } } },
      });
      if (!advanceRequest) throw new HttpError("Customer gold request not found", 404);
      if (!advanceRequest.advance.customerId || (input.customerId && input.customerId !== advanceRequest.advance.customerId)) {
        throw new HttpError("The sale customer must match the customer who requested this gold", 400);
      }
      const fulfilledGrams = advanceRequest.fulfillments.reduce((sum, item) => sum.plus(item.grams), new Prisma.Decimal(0));
      if (fulfilledGrams.plus(grossGrams).greaterThan(advanceRequest.requestedGrams)) {
        throw new HttpError("Fulfillment cannot exceed the customer’s remaining requested weight", 409);
      }
      const balance = await getCustomerAdvanceBalance(tx, advanceRequest.advanceId);
      if (!balance.isFinite()) throw new HttpError("Unable to calculate the customer advance balance", 500);
      if (initialPayment.greaterThan(0)) throw new HttpError("Advance fulfillments cannot collect a sale payment in the same action", 400);
    }
    const saleFormula = purchaseFormulaRules(await tx.purchaseFormulaConfig.findUnique({ where: { id: "default" } }));
    const saleMeasurements = calculateMeasuredSaleQuote(
      input.topGrams ?? "",
      input.downGrams ?? "",
      currentBoardPrice.priceAmount.toString(),
      input.discountAmount,
      saleFormula,
    );
    if (!saleMeasurements.topGrams.equals(grossGrams)) {
      throw new HttpError("Top weight measurement must match the total grams allocated from stock batches", 400);
    }
    if (input.purityBps !== saleMeasurements.purityBps) {
      throw new HttpError("The sale measurement changed. Recalculate the measurements and try again.", 409);
    }
    const customerId = advanceRequest?.advance.customerId ?? (input.customerId || null);
    if (customerId) {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer || !customer.isActive || customer.kind !== "BUYER") throw new HttpError("Select an active buyer", 400);
    }
    const lotIds = [...allocationsByLot.keys()].sort();
    await tx.$queryRaw`SELECT id FROM InventoryLot WHERE id IN (${Prisma.join(lotIds)}) ORDER BY id FOR UPDATE`;
    const lots = await tx.inventoryLot.findMany({ where: { id: { in: lotIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (lots.length !== lotIds.length) throw new HttpError("One or more selected stock batches are no longer available", 409);
    const ledgerMovements = await tx.stockMovement.groupBy({
      by: ["inventoryLotId", "type"],
      where: { inventoryLotId: { in: lotIds } },
      _sum: { quantityGrams: true },
    });
    const ledgerByLot = new Map<string, { type: typeof ledgerMovements[number]["type"]; quantityGrams: Prisma.Decimal }[]>();
    for (const movement of ledgerMovements) {
      if (!movement.inventoryLotId) continue;
      const records = ledgerByLot.get(movement.inventoryLotId) ?? [];
      records.push({ type: movement.type, quantityGrams: movement._sum.quantityGrams ?? new Prisma.Decimal(0) });
      ledgerByLot.set(movement.inventoryLotId, records);
    }
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    for (const [lotId, requested] of allocationsByLot) {
      const lot = lotById.get(lotId);
      if (!lot) throw new HttpError("A selected batch is no longer available", 409);
      const ledgerBalance = movementBalance(ledgerByLot.get(lotId) ?? []);
      if (!ledgerBalance.equals(lot.remainingGrams)) {
        throw new HttpError(`Batch ${lot.batchNumber || lot.id} does not match its stock ledger. Reconcile inventory before selling.`, 409);
      }
      if (lot.status !== "ACTIVE" || requested.greaterThan(ledgerBalance)) throw new HttpError("A selected batch no longer has enough available stock", 409);
    }

    const salePrice = currentBoardPrice.priceAmount;
    const salePurityBps = saleMeasurements.purityBps;
    const subtotal = saleMeasurements.subtotal;
    if (discountAmount.greaterThanOrEqualTo(subtotal)) throw new HttpError("Discount must be less than the calculated sale value", 400);
    const total = subtotal.minus(discountAmount);
    if (initialPayment.greaterThan(total)) throw new HttpError("Amount paid cannot exceed the sale total after discount", 400);
    const transactionDate = new Date(input.transactionDate);
    if (transactionDate > new Date()) throw new HttpError("Sale date cannot be in the future", 400);

    const created = await tx.trade.create({
      data: {
        reference: reference("SAL"),
        type: "SALE",
        status: "POSTED",
        customerId,
        quantityKg,
        purityBps: salePurityBps,
        pricePerGram: salePrice,
        totalAmount: total,
        discountAmount,
        transactionDate,
        paymentAmount: advanceRequest ? total : initialPayment,
        paymentMethod: input.method,
        priceUnit: currentBoardPrice?.priceUnit ?? "GHS_PER_GRAM_PURE_GOLD",
        boardPriceId: currentBoardPrice?.id,
        note: input.note || null,
        createdById: user.id,
      },
    });

    await tx.goldSaleMeasurement.create({
      data: {
        tradeId: created.id,
        topGrams: saleMeasurements.topGrams,
        downGrams: saleMeasurements.downGrams,
        pounds: saleMeasurements.pounds,
        density: saleMeasurements.density,
        karat: saleMeasurements.karat,
        formulaVersion: saleFormula.version,
        formulaInputs: {
          topGrams: saleMeasurements.topGrams.toString(),
          downGrams: saleMeasurements.downGrams.toString(),
          sellingBoardPrice: currentBoardPrice.priceAmount.toString(),
          poundsKgDivisor: saleFormula.poundsKgDivisor,
          densityReference: saleFormula.densityReference,
          karatMultiplier: saleFormula.karatMultiplier,
          karatDiscountMultiplier: saleFormula.karatDiscountMultiplier,
          amountKaratDivisor: saleFormula.amountKaratDivisor,
        },
        calculationSource: "sales_measurement_modal",
      },
    });

    const fulfillment = advanceRequest && currentBoardPrice
      ? await tx.advanceFulfillment.create({
        data: {
          reference: reference("FUL"),
          requestId: advanceRequest.id,
          tradeId: created.id,
          boardPriceId: currentBoardPrice.id,
          grams: grossGrams,
          amount: total,
          pricePerGram: currentBoardPrice.priceAmount,
          purityBps: salePurityBps,
          createdById: user.id,
        },
      })
      : null;

    let costBasis = new Prisma.Decimal(0);
    for (const [lotId, grams] of allocationsByLot) {
      const lot = lotById.get(lotId);
      if (!lot) throw new Error("Locked inventory lot missing from sale allocation");
      const costAmount = grams.mul(lot.costPerGram).toDecimalPlaces(2);
      const nextBalance = new Prisma.Decimal(lot.remainingGrams).minus(grams);
      await tx.inventoryLot.update({
        where: { id: lotId },
        data: { remainingGrams: nextBalance, status: nextBalance.isZero() ? "DEPLETED" : "ACTIVE" },
      });
      await tx.inventoryAllocation.create({ data: { tradeId: created.id, lotId, grams, costAmount } });
      await tx.stockMovement.create({
        data: {
          reference: reference("MOV"),
          type: "SALE_ISSUE",
          tradeId: created.id,
          advanceFulfillmentId: fulfillment?.id,
          inventoryLotId: lotId,
          locationId: lot.storageLocationId,
          quantityGrams: grams,
          movementDate: transactionDate,
          reason: fulfillment ? `Customer advance fulfillment ${fulfillment.reference}` : "Sale issue",
          createdById: user.id,
        },
      });
      costBasis = costBasis.plus(costAmount);
    }
    await tx.trade.update({ where: { id: created.id }, data: { costBasis: costBasis.toDecimalPlaces(2) } });
    if (initialPayment.greaterThan(0)) {
      const payment = await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: "INBOUND",
          amount: initialPayment,
          method: input.method,
          cashAccountId: input.cashAccountId || null,
          note: input.note || null,
          paidAt: transactionDate,
          tradeId: created.id,
          customerId,
          createdById: user.id,
        },
      });
      await recordPaymentMovement(tx, {
        paymentId: payment.id,
        cashAccountId: input.cashAccountId,
        direction: payment.direction,
        amount: payment.amount,
        movementDate: payment.paidAt,
        description: `Sale payment for ${created.reference}`,
        createdById: user.id,
      });
    }
    await addAudit(tx, {
      userId: user.id,
      action: "sale.completed",
      entity: "Trade",
      entityId: created.id,
      details: {
        reference: created.reference,
        quantityKg: quantityKg.toString(),
        subtotal: subtotal.toString(),
        discountAmount: discountAmount.toString(),
        amount: total.toString(),
        allocations: [...allocationsByLot].map(([lotId, grams]) => ({ lotId, grams: grams.toString() })),
        advanceFulfillment: fulfillment ? {
          reference: fulfillment.reference,
          advanceId,
          requestId: advanceRequest?.id,
          amount: fulfillment.amount.toString(),
          boardPrice: fulfillment.pricePerGram.toString(),
        } : null,
      },
    });
    if (fulfillment) {
      await addAudit(tx, {
        userId: user.id,
        action: "customer.advance.gold_fulfilled",
        entity: "AdvanceFulfillment",
        entityId: fulfillment.id,
        details: {
          reference: fulfillment.reference,
          requestId: advanceRequest?.id,
          tradeReference: created.reference,
          grams: fulfillment.grams.toString(),
          amount: fulfillment.amount.toString(),
          pricePerGram: fulfillment.pricePerGram.toString(),
          purityBps: fulfillment.purityBps,
        },
      });
    }
    return tx.trade.findUniqueOrThrow({
      where: { id: created.id },
      include: { customer: { select: { id: true, name: true, code: true } }, payments: true, advanceFulfillment: true, allocations: { include: { lot: { include: { trade: { select: { reference: true } } } } } } },
    });
  });
}

export async function correctSale(
  userId: string,
  tradeId: string,
  input: SaleCorrectionInput,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Trade WHERE id = ${tradeId} FOR UPDATE`;
    if (!locked.length) throw new HttpError("Sale not found", 404);
    const sale = await tx.trade.findUnique({
      where: { id: tradeId },
      include: {
        allocations: true,
        corrections: { include: { allocations: true } },
        payments: { where: { direction: "INBOUND" } },
      },
    });
    if (!sale || sale.type !== "SALE" || sale.status !== "POSTED") {
      throw new HttpError("Only an active completed sale can be returned or reversed", 409);
    }
    if (input.type === "REVERSAL" && sale.corrections.length > 0) {
      throw new HttpError("A sale with previous returns cannot be fully reversed. Record a return for the remaining batches instead.", 409);
    }

    const soldByLot = new Map<string, Prisma.Decimal>();
    for (const allocation of sale.allocations) {
      soldByLot.set(allocation.lotId, (soldByLot.get(allocation.lotId) ?? new Prisma.Decimal(0)).plus(allocation.grams));
    }
    const returnedByLot = new Map<string, Prisma.Decimal>();
    for (const correction of sale.corrections) {
      for (const allocation of correction.allocations) {
        returnedByLot.set(allocation.lotId, (returnedByLot.get(allocation.lotId) ?? new Prisma.Decimal(0)).plus(allocation.grams));
      }
    }
    let requested: BatchAllocation[];
    if (input.type === "REVERSAL") {
      requested = [...soldByLot].map(([lotId, grams]) => ({ lotId, grams }));
    } else {
      const byLot = new Map<string, Prisma.Decimal>();
      for (const allocation of input.allocations) {
        byLot.set(allocation.lotId, (byLot.get(allocation.lotId) ?? new Prisma.Decimal(0)).plus(allocation.grams));
      }
      requested = [...byLot].map(([lotId, grams]) => ({ lotId, grams }));
      for (const allocation of requested) {
        const remaining = (soldByLot.get(allocation.lotId) ?? new Prisma.Decimal(0))
          .minus(returnedByLot.get(allocation.lotId) ?? 0);
        if (!soldByLot.has(allocation.lotId) || allocation.grams.greaterThan(remaining)) {
          throw new HttpError("Returned weight cannot exceed the sale's unreturned amount in that batch", 400);
        }
      }
    }
    const requestedGrams = requested.reduce((sum, allocation) => sum.plus(allocation.grams), new Prisma.Decimal(0));
    if (!requestedGrams.greaterThan(0) || requestedGrams.decimalPlaces() > 5) throw new HttpError("Return weight must be positive and within stock precision", 400);
    const totalGrams = new Prisma.Decimal(sale.quantityKg).mul(1000);
    const previousGrams = [...returnedByLot.values()].reduce((sum, grams) => sum.plus(grams), new Prisma.Decimal(0));
    const fullyReturned = previousGrams.plus(requestedGrams).equals(totalGrams);
    const previousCredit = sale.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), new Prisma.Decimal(0));
    const creditAmount = fullyReturned
      ? new Prisma.Decimal(sale.totalAmount).minus(previousCredit)
      : new Prisma.Decimal(sale.totalAmount).mul(requestedGrams).div(totalGrams).toDecimalPlaces(2);
    const received = sale.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
    const previouslyRefunded = sale.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), new Prisma.Decimal(0));
    const refundableCash = received.minus(previouslyRefunded);
    const refundAmount = fullyReturned
      ? refundableCash
      : Prisma.Decimal.min(refundableCash, creditAmount.mul(received).div(sale.totalAmount).toDecimalPlaces(2));
    const quantityKg = requestedGrams.div(1000);
    const returnedLotIds = [...new Set(requested.map((allocation) => allocation.lotId))].sort();
    await tx.$queryRaw`SELECT id FROM InventoryLot WHERE id IN (${Prisma.join(returnedLotIds)}) ORDER BY id FOR UPDATE`;
    const returnedLots = await tx.inventoryLot.findMany({ where: { id: { in: returnedLotIds } } });
    const returnedLotById = new Map(returnedLots.map((lot) => [lot.id, lot]));
    const returnedMovements = await tx.stockMovement.groupBy({
      by: ["inventoryLotId", "type"],
      where: { inventoryLotId: { in: returnedLotIds } },
      _sum: { quantityGrams: true },
    });
    const movementsByLot = new Map<string, { type: typeof returnedMovements[number]["type"]; quantityGrams: Prisma.Decimal }[]>();
    for (const movement of returnedMovements) {
      if (!movement.inventoryLotId) continue;
      const records = movementsByLot.get(movement.inventoryLotId) ?? [];
      records.push({ type: movement.type, quantityGrams: movement._sum.quantityGrams ?? new Prisma.Decimal(0) });
      movementsByLot.set(movement.inventoryLotId, records);
    }
    for (const lotId of returnedLotIds) {
      const lot = returnedLotById.get(lotId);
      if (!lot || !movementBalance(movementsByLot.get(lotId) ?? []).equals(lot.remainingGrams)) {
        throw new HttpError("A returned batch does not match its stock ledger. Reconcile inventory first.", 409);
      }
    }
    const correction = await tx.saleCorrection.create({
      data: {
        reference: reference(input.type === "REVERSAL" ? "REV" : "RET"),
        type: input.type as SaleCorrectionType,
        tradeId: sale.id,
        quantityGrams: requestedGrams,
        creditAmount,
        refundAmount,
        reason: input.reason,
        note: input.note || null,
        createdById: userId,
      },
    });
    for (const allocation of requested) {
      const lot = returnedLotById.get(allocation.lotId);
      if (!lot) throw new HttpError("A sale batch no longer exists", 409);
      const nextBalance = new Prisma.Decimal(lot.remainingGrams).plus(allocation.grams);
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { remainingGrams: nextBalance, status: "ACTIVE" },
      });
      await tx.saleCorrectionAllocation.create({
        data: { correctionId: correction.id, lotId: lot.id, grams: allocation.grams },
      });
      await tx.stockMovement.create({
        data: {
          reference: reference("MOV"),
          type: "SALE_RETURN",
          tradeId: sale.id,
          correctionId: correction.id,
          inventoryLotId: lot.id,
          locationId: lot.storageLocationId,
          quantityGrams: allocation.grams,
          movementDate: new Date(),
          reason: input.reason,
          createdById: userId,
        },
      });
    }
    if (refundAmount.greaterThan(0)) {
      await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: "OUTBOUND",
          amount: refundAmount,
          method: sale.paymentMethod,
          note: `Refund for ${correction.reference}: ${input.reason}`,
          paidAt: new Date(),
          saleCorrectionId: correction.id,
          customerId: sale.customerId,
          createdById: userId,
        },
      });
    }
    if (input.type === "REVERSAL") {
      await tx.trade.update({ where: { id: sale.id }, data: { status: "VOIDED" } });
    } else if (fullyReturned) {
      await tx.trade.update({ where: { id: sale.id }, data: { status: "RETURNED" } });
    }
    await addAudit(tx, {
      userId,
      action: input.type === "REVERSAL" ? "sale.reversed" : "sale.returned",
      entity: "SaleCorrection",
      entityId: correction.id,
      details: {
        reference: correction.reference,
        saleReference: sale.reference,
        quantityKg: quantityKg.toString(),
        creditAmount: creditAmount.toString(),
        refundAmount: refundAmount.toString(),
        reason: input.reason,
      },
    });
    return tx.saleCorrection.findUniqueOrThrow({
      where: { id: correction.id },
      include: { allocations: { include: { lot: { include: { trade: { select: { reference: true } } } } } }, createdBy: { select: { name: true } } },
    });
  });
}
