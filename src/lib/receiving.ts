import { Prisma, type Trade } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addAudit, generateBatchNumber, reference } from "@/lib/records";
import { HttpError } from "@/lib/http";
import { calculatePurchaseMeasurements } from "@/lib/gold";
import { purchaseFormulaRules } from "@/lib/purchase-formula";
import { resolveStorageLocation } from "@/lib/inventory";
import { recordPaymentMovement } from "@/lib/finance";
import { getBuyerFinanceBalance } from "@/lib/buyer-financing";
import type { ReceivingInput } from "@/lib/validation";

type TransactionClient = Prisma.TransactionClient;

async function prepareReceiving(tx: TransactionClient, input: ReceivingInput, existingBatchNumber?: string | null) {
  const rules = purchaseFormulaRules(await tx.purchaseFormulaConfig.findUnique({ where: { id: "default" } }));
  const [customer, boardPrice] = await Promise.all([
    tx.customer.findUnique({ where: { id: input.customerId } }),
    tx.goldBoardPrice.findUnique({ where: { id: input.boardPriceId } }),
  ]);
  if (!customer || !customer.isActive || (
    customer.kind !== "SUPPLIER" && !(customer.kind === "BUYER" && (input.action === "DRAFT" || Boolean(input.financingAccountId)))
  )) {
    throw new HttpError("An active buyer can only be used for a draft or a purchase with their matching financing account", 400);
  }
  if (!boardPrice || boardPrice.priceType !== "RECEIVING" || boardPrice.currency !== "GHS" || boardPrice.priceUnit !== rules.priceUnit) {
    throw new HttpError("Select a GHS board price quoted in the compatible pure-gold gram unit", 400);
  }

  const calculations = calculatePurchaseMeasurements(input.topGrams, input.downGrams, boardPrice.priceAmount.toString(), rules);
  const amountPaid = new Prisma.Decimal(input.amountPaid);
  let financingAccount: { id: string; reference: string; customerId: string } | null = null;
  let financingBalanceBefore: Prisma.Decimal | null = null;
  if (input.financingAccountId) {
    if (input.action !== "COMPLETE" || amountPaid.greaterThan(0)) {
      throw new HttpError("Buyer financing can only be applied to a completed purchase without a separate cash payment", 400);
    }
    await tx.$queryRaw`SELECT id FROM BuyerFinanceAccount WHERE id = ${input.financingAccountId} FOR UPDATE`;
    const account = await tx.buyerFinanceAccount.findUnique({
      where: { id: input.financingAccountId },
      include: { customer: true },
    });
    if (!account || !account.customer.isActive || account.customer.kind !== "BUYER") {
      throw new HttpError("Select an active buyer financing account", 400);
    }
    if (account.customerId !== customer.id) {
      throw new HttpError("The selected buyer financing account must belong to the purchase customer", 400);
    }
    financingAccount = account;
    financingBalanceBefore = await getBuyerFinanceBalance(tx, account.id);
  }
  if (amountPaid.greaterThan(calculations.amount)) {
    throw new HttpError("Amount paid cannot exceed the calculated purchase amount", 400);
  }
  const batchNumber = input.batchNumber?.trim() || existingBatchNumber?.trim() || await generateBatchNumber(tx);
  return { customer, boardPrice, calculations, amountPaid, financingAccount, financingBalanceBefore, rules, batchNumber };
}

function createTradeData(input: ReceivingInput, prepared: Awaited<ReturnType<typeof prepareReceiving>>, userId: string) {
  const { boardPrice, calculations, rules } = prepared;
  return {
    reference: reference("PUR"),
    type: "PURCHASE" as const,
    status: input.action === "COMPLETE" ? "POSTED" as const : "DRAFT" as const,
    customerId: prepared.customer.id,
    quantityKg: calculations.topGrams.div(1000),
    purityBps: calculations.karat.div(24).mul(10000).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    pricePerGram: boardPrice.priceAmount,
    totalAmount: calculations.amount,
    note: input.note || null,
    transactionDate: new Date(input.transactionDate),
    priceUnit: rules.priceUnit,
    boardPriceId: boardPrice.id,
    inventoryBatchNumber: prepared.batchNumber,
    paymentAmount: prepared.financingAccount ? calculations.amount : prepared.amountPaid,
    paymentMethod: input.paymentMethod,
    supportingDocumentRef: input.supportingDocumentRef || null,
    createdById: userId,
  };
}

export async function saveReceiving(
  tx: TransactionClient,
  userId: string,
  input: ReceivingInput,
  existingDraft?: Trade,
) {
  const prepared = await prepareReceiving(tx, input, existingDraft?.inventoryBatchNumber);
  if (input.action === "COMPLETE" && !prepared.rules.ownerConfirmed) {
    throw new HttpError(
      "Purchases cannot be completed until an authorized administrator confirms the saved purchase formulas and units.",
      409,
    );
  }
  const tradeData = createTradeData(input, prepared, userId);
  const trade = existingDraft
    ? await tx.trade.update({
      where: { id: existingDraft.id },
      data: { ...tradeData, reference: existingDraft.reference },
    })
    : await tx.trade.create({ data: tradeData });
  const formulaInputs: Prisma.InputJsonObject = {
    topGrams: prepared.calculations.topGrams.toString(),
    downGrams: prepared.calculations.downGrams.toString(),
    boardPriceId: prepared.boardPrice.id,
    boardPrice: prepared.boardPrice.priceAmount.toString(),
    priceUnit: prepared.rules.priceUnit,
    inventoryBatchNumber: prepared.batchNumber,
    storageLocationName: input.storageLocation,
    transactionDate: input.transactionDate,
    amountPaid: prepared.amountPaid.toString(),
    paymentMethod: input.paymentMethod,
  };
  await tx.goldPurchaseMeasurement.upsert({
    where: { tradeId: trade.id },
    create: {
      tradeId: trade.id,
      topKg: prepared.calculations.topGrams.div(1000).toDecimalPlaces(8),
      downKg: prepared.calculations.downGrams.div(1000).toDecimalPlaces(8),
      pounds: prepared.calculations.pounds.toDecimalPlaces(8),
      density: prepared.calculations.density.toDecimalPlaces(8),
      karat: prepared.calculations.karat.toDecimalPlaces(8),
      formulaVersion: prepared.rules.version,
      formulaInputs,
      calculationSource: "CALCULATED",
    },
    update: {
      topKg: prepared.calculations.topGrams.div(1000).toDecimalPlaces(8),
      downKg: prepared.calculations.downGrams.div(1000).toDecimalPlaces(8),
      pounds: prepared.calculations.pounds.toDecimalPlaces(8),
      density: prepared.calculations.density.toDecimalPlaces(8),
      karat: prepared.calculations.karat.toDecimalPlaces(8),
      formulaVersion: prepared.rules.version,
      formulaInputs,
      calculationSource: "CALCULATED",
    },
  });

  if (input.action === "DRAFT") {
    await addAudit(tx, {
      userId,
      action: existingDraft ? "trade.purchase.draft.updated" : "trade.purchase.draft.created",
      entity: "Trade",
      entityId: trade.id,
      details: { reference: trade.reference, formulaVersion: prepared.rules.version },
    });
    return tx.trade.findUniqueOrThrow({ where: { id: trade.id }, include: { purchaseMeasurement: true } });
  }

  const grams = prepared.calculations.topGrams.toDecimalPlaces(5);
  const storageLocation = await resolveStorageLocation(tx, input.storageLocation, userId);
  const inventoryLot = await tx.inventoryLot.create({
    data: {
      tradeId: trade.id,
      batchNumber: prepared.batchNumber,
      source: prepared.customer.name,
      receivedAt: new Date(input.transactionDate),
      originalGrams: grams,
      remainingGrams: grams,
      costPerGram: prepared.calculations.amount.div(grams).toDecimalPlaces(6),
      purityBps: trade.purityBps,
      density: prepared.calculations.density.toDecimalPlaces(8),
      pounds: prepared.calculations.pounds.toDecimalPlaces(8),
      storageLocationId: storageLocation.id,
    },
  });
  await tx.stockMovement.create({
    data: {
      reference: reference("MOV"),
      type: "PURCHASE_RECEIPT",
      tradeId: trade.id,
      inventoryLotId: inventoryLot.id,
      locationId: storageLocation.id,
      quantityGrams: grams,
      movementDate: new Date(input.transactionDate),
      reason: "Received purchase stock",
      createdById: userId,
    },
  });
  if (prepared.amountPaid.greaterThan(0)) {
    const payment = await tx.payment.create({
      data: {
        reference: reference("PAY"),
        direction: "OUTBOUND",
        amount: prepared.amountPaid,
        method: input.paymentMethod,
        cashAccountId: input.cashAccountId || null,
        note: input.note || null,
        paidAt: new Date(input.transactionDate),
        tradeId: trade.id,
        customerId: prepared.customer.id,
        createdById: userId,
      },
    });
    await recordPaymentMovement(tx, {
      paymentId: payment.id,
      cashAccountId: input.cashAccountId,
      direction: payment.direction,
      amount: payment.amount,
      movementDate: payment.paidAt,
      description: `Purchase payment for ${trade.reference}`,
      createdById: userId,
    });
  }
  if (prepared.financingAccount) {
    await tx.buyerFinanceSettlement.create({
      data: {
        reference: reference("BFS"),
        accountId: prepared.financingAccount.id,
        tradeId: trade.id,
        amount: prepared.calculations.amount,
        createdById: userId,
      },
    });
  }
  await addAudit(tx, {
    userId,
    action: existingDraft ? "trade.purchase.completed" : "trade.purchase.posted",
    entity: "Trade",
    entityId: trade.id,
    details: {
      reference: trade.reference,
      formulaVersion: prepared.rules.version,
      amount: prepared.calculations.amount.toString(),
      topGrams: prepared.calculations.topGrams.toString(),
      downGrams: prepared.calculations.downGrams.toString(),
      ...(prepared.financingAccount ? {
        buyerFinanceAccountId: prepared.financingAccount.id,
        buyerFinanceAccountReference: prepared.financingAccount.reference,
        financingBalanceBefore: prepared.financingBalanceBefore?.toString() ?? "0.00",
        financingBalanceAfter: prepared.financingBalanceBefore?.minus(prepared.calculations.amount).toString() ?? prepared.calculations.amount.negated().toString(),
        settledAmount: prepared.calculations.amount.toString(),
      } : {}),
    },
  });
  return tx.trade.findUniqueOrThrow({ where: { id: trade.id }, include: { purchaseMeasurement: true } });
}

export async function prepareReceivingForSave(userId: string, input: ReceivingInput, existingDraft?: Trade) {
  return prisma.$transaction(async (tx) => saveReceiving(tx, userId, input, existingDraft));
}
