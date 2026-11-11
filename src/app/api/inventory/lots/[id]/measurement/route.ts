import { Prisma } from "@prisma/client";
import { assertPermission, requireUser } from "@/lib/authz";
import { calculatePurchaseMeasurements } from "@/lib/gold";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { movementBalance } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import { purchaseFormulaRules } from "@/lib/purchase-formula";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { purchaseMeasurementCorrectionSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("purchases:write");
    assertPermission(user, "inventory:adjust");
    const { id } = await context.params;
    const input = purchaseMeasurementCorrectionSchema.parse(await readJson(request));
    await enforceUserRateLimit(user.id, "inventory-write", { limit: 20 });

    const result = await prisma.$transaction(async (tx) => {
      const lockedLot = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM InventoryLot WHERE id = ${id} FOR UPDATE`;
      if (!lockedLot.length) throw new HttpError("Stock batch not found", 404);
      const lot = await tx.inventoryLot.findUnique({
        where: { id },
        include: {
          trade: {
            include: {
              purchaseMeasurement: true,
              buyerFinanceSettlement: true,
            },
          },
        },
      });
      if (!lot?.trade || !lot.trade.purchaseMeasurement) {
        throw new HttpError("This stock batch does not have editable purchase measurements", 409);
      }

      const tradeLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Trade WHERE id = ${lot.trade.id} FOR UPDATE`;
      if (!tradeLock.length) throw new HttpError("The purchase record no longer exists", 409);
      const currentTrade = await tx.trade.findUnique({
        where: { id: lot.trade.id },
        include: { purchaseMeasurement: true, buyerFinanceSettlement: true },
      });
      if (!currentTrade || currentTrade.type !== "PURCHASE" || currentTrade.status !== "POSTED"
        || !currentTrade.purchaseMeasurement
        || currentTrade.purchaseMeasurement.calculationSource !== "CALCULATED") {
        throw new HttpError("Only completed standard purchase batches can have their measurements corrected", 409);
      }
      if (lot.status !== "ACTIVE") throw new HttpError("Only active stock batches can have their measurements corrected", 409);

      const activeStocktakeLine = await tx.inventoryReconciliationLine.findFirst({
        where: { inventoryLotId: lot.id, reconciliation: { status: "IN_PROGRESS" } },
        select: { id: true },
      });
      if (activeStocktakeLine) throw new HttpError("This batch is included in an open stocktake. Complete or cancel the stocktake before editing it.", 409);

      const measurements = await tx.stockMovement.findMany({
        where: { inventoryLotId: lot.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, reference: true, type: true, tradeId: true, quantityGrams: true },
      });
      const receiptMovements = measurements.filter((movement) => movement.type === "PURCHASE_RECEIPT");
      const unsupportedMovement = measurements.some((movement) =>
        !["PURCHASE_RECEIPT", "MEASUREMENT_CORRECTION_IN", "MEASUREMENT_CORRECTION_OUT"].includes(movement.type));
      if (receiptMovements.length !== 1 || receiptMovements[0]?.tradeId !== currentTrade.id || unsupportedMovement) {
        throw new HttpError("Measurements can only be edited before this batch is sold, transferred, adjusted, or stocktaken", 409);
      }

      const balance = movementBalance(measurements.map((movement) => ({
        type: movement.type,
        quantityGrams: movement.quantityGrams,
      })));
      if (!balance.equals(lot.remainingGrams) || !balance.equals(lot.originalGrams)) {
        throw new HttpError("The batch balance does not match its ledger. Reconcile this batch before correcting measurements.", 409);
      }

      const formulaConfig = await tx.purchaseFormulaConfig.findUnique({ where: { id: "default" } });
      const rules = purchaseFormulaRules(formulaConfig);
      const currentMeasurement = currentTrade.purchaseMeasurement;
      if (!rules.ownerConfirmed || rules.version !== currentMeasurement.formulaVersion
        || currentTrade.priceUnit !== rules.priceUnit) {
        throw new HttpError("The purchase formula has changed since this batch was recorded. Ask an administrator to review the formula before editing.", 409);
      }
      if (currentTrade.buyerFinanceSettlement) assertPermission(user, "payments:write");
      const boardPrice = await tx.goldBoardPrice.findUnique({ where: { id: input.boardPriceId } });
      if (!boardPrice || boardPrice.priceType !== "RECEIVING" || boardPrice.currency !== "GHS"
        || boardPrice.priceUnit !== rules.priceUnit || boardPrice.effectiveAt > new Date()) {
        throw new HttpError("Select a published GHS receiving price with the compatible price unit", 400);
      }

      let calculated: ReturnType<typeof calculatePurchaseMeasurements>;
      try {
        calculated = calculatePurchaseMeasurements(input.topGrams, input.downGrams, boardPrice.priceAmount.toString(), rules);
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message, 400);
        throw error;
      }

      const grams = calculated.topGrams.toDecimalPlaces(5);
      if (!grams.equals(calculated.topGrams)) {
        throw new HttpError("Top weight exceeds the supported stock precision", 400);
      }
      const beforeTopGrams = currentMeasurement.topKg.mul(1000);
      const beforeDownGrams = currentMeasurement.downKg.mul(1000);
      if (!lot.originalGrams.equals(beforeTopGrams)
        || !currentTrade.quantityKg.mul(1000).equals(beforeTopGrams)) {
        throw new HttpError("The saved purchase measurements do not match the batch weight. Reconcile this record before editing.", 409);
      }
      if (beforeTopGrams.equals(calculated.topGrams)
        && beforeDownGrams.equals(calculated.downGrams)
        && currentTrade.pricePerGram.equals(boardPrice.priceAmount)) {
        throw new HttpError("Change a weight or select a different receiving price before saving", 400);
      }
      const delta = grams.minus(balance);
      const newPurityBps = calculated.karat.div(24).mul(10000)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
      const topKg = calculated.topGrams.div(1000).toDecimalPlaces(8);
      const downKg = calculated.downGrams.div(1000).toDecimalPlaces(8);
      const previousFormulaInputs = currentMeasurement.formulaInputs;
      const formulaInputs: Prisma.InputJsonObject = {
        ...(previousFormulaInputs && typeof previousFormulaInputs === "object" && !Array.isArray(previousFormulaInputs)
          ? previousFormulaInputs
          : {}),
        topGrams: calculated.topGrams.toString(),
        downGrams: calculated.downGrams.toString(),
        boardPriceId: boardPrice.id,
        boardPrice: boardPrice.priceAmount.toString(),
        lastCorrectionReason: input.reason,
        lastCorrectionAt: new Date().toISOString(),
        lastCorrectedBy: user.id,
      };

      const updatedTrade = await tx.trade.update({
        where: { id: currentTrade.id },
        data: {
          quantityKg: topKg,
          purityBps: newPurityBps,
          pricePerGram: boardPrice.priceAmount,
          boardPriceId: boardPrice.id,
          totalAmount: calculated.amount,
          ...(currentTrade.buyerFinanceSettlement ? { paymentAmount: calculated.amount } : {}),
        },
      });
      await tx.goldPurchaseMeasurement.update({
        where: { tradeId: currentTrade.id },
        data: {
          topKg,
          downKg,
          pounds: calculated.pounds.toDecimalPlaces(8),
          density: calculated.density.toDecimalPlaces(8),
          karat: calculated.karat.toDecimalPlaces(8),
          formulaInputs,
        },
      });
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          originalGrams: grams,
          remainingGrams: grams,
          costPerGram: calculated.amount.div(grams).toDecimalPlaces(6),
          purityBps: newPurityBps,
          density: calculated.density.toDecimalPlaces(8),
          pounds: calculated.pounds.toDecimalPlaces(8),
        },
      });

      let correctionReference: string | null = null;
      if (!delta.isZero()) {
        const correction = await tx.stockMovement.create({
          data: {
            reference: reference("MOV"),
            type: delta.isPositive() ? "MEASUREMENT_CORRECTION_IN" : "MEASUREMENT_CORRECTION_OUT",
            tradeId: currentTrade.id,
            inventoryLotId: lot.id,
            locationId: lot.storageLocationId,
            quantityGrams: delta.abs(),
            movementDate: new Date(),
            reason: `Receiving measurement correction for ${currentTrade.reference}: ${input.reason}`,
            createdById: user.id,
          },
          select: { reference: true },
        });
        correctionReference = correction.reference;
      }

      if (currentTrade.buyerFinanceSettlement) {
        await tx.buyerFinanceSettlement.update({
          where: { id: currentTrade.buyerFinanceSettlement.id },
          data: { amount: calculated.amount },
        });
      }

      await addAudit(tx, {
        userId: user.id,
        action: "inventory.purchase.measurements.corrected",
        entity: "Trade",
        entityId: currentTrade.id,
        details: {
          reference: currentTrade.reference,
          batchNumber: lot.batchNumber,
          reason: input.reason,
          before: {
            topGrams: beforeTopGrams.toString(),
            downGrams: beforeDownGrams.toString(),
            amount: currentTrade.totalAmount.toString(),
            pricePerGram: currentTrade.pricePerGram.toString(),
            purityBps: currentTrade.purityBps,
            stockGrams: balance.toString(),
          },
          after: {
            topGrams: calculated.topGrams.toString(),
            downGrams: calculated.downGrams.toString(),
            amount: updatedTrade.totalAmount.toString(),
            pricePerGram: updatedTrade.pricePerGram.toString(),
            purityBps: updatedTrade.purityBps,
            stockGrams: grams.toString(),
          },
          correctionMovement: correctionReference,
        },
      });
      return { trade: updatedTrade, correctionReference };
    }, { maxWait: 10_000, timeout: 30_000 });

    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
