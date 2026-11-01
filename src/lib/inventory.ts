import { Prisma, type StockMovementType } from "@prisma/client";
import "@/lib/decimal-policy";
import type { InventoryMovementInput } from "@/lib/validation";
import { addAudit, generateBatchNumber, reference } from "@/lib/records";
import { HttpError } from "@/lib/http";

type InventoryTransaction = Prisma.TransactionClient;

const zero = () => new Prisma.Decimal(0);

const movementSigns: Record<StockMovementType, number> = {
  OPENING_BALANCE: 1,
  PURCHASE_RECEIPT: 1,
  SALE_ISSUE: -1,
  SALE_RETURN: 1,
  ADJUSTMENT_IN: 1,
  ADJUSTMENT_OUT: -1,
  TRANSFER_IN: 1,
  TRANSFER_OUT: -1,
  STOCK_CORRECTION_IN: 1,
  STOCK_CORRECTION_OUT: -1,
};

export function movementBalance(movements: { type: StockMovementType; quantityGrams: Prisma.Decimal | string | number }[]) {
  return movements.reduce((balance, movement) => {
    const quantity = new Prisma.Decimal(movement.quantityGrams);
    if (!quantity.isFinite() || quantity.isNegative()) throw new Error("Stock movement has an invalid quantity");
    return balance.plus(quantity.mul(movementSigns[movement.type]));
  }, zero());
}

export function ledgerBalances(movements: {
  inventoryLotId: string | null;
  type: StockMovementType;
  quantityGrams: Prisma.Decimal | string | number;
}[]) {
  const balances = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    if (!movement.inventoryLotId) continue;
    const delta = new Prisma.Decimal(movement.quantityGrams).mul(movementSigns[movement.type]);
    balances.set(movement.inventoryLotId, (balances.get(movement.inventoryLotId) ?? zero()).plus(delta));
  }
  return balances;
}

async function lockedLot(tx: InventoryTransaction, lotId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM InventoryLot WHERE id = ${lotId} FOR UPDATE`;
  if (!locked.length) throw new HttpError("Stock batch not found", 404);
  const lot = await tx.inventoryLot.findUnique({ where: { id: lotId } });
  if (!lot) throw new HttpError("Stock batch not found", 404);
  const movements = await tx.stockMovement.groupBy({
    by: ["type"],
    where: { inventoryLotId: lotId },
    _sum: { quantityGrams: true },
  });
  const balance = movementBalance(movements.map((movement) => ({
    type: movement.type,
    quantityGrams: movement._sum.quantityGrams ?? zero(),
  })));
  return { lot, balance };
}

export async function resolveStorageLocation(tx: InventoryTransaction, name: string, userId: string) {
  return tx.storageLocation.upsert({
    where: { name },
    create: { name, createdById: userId },
    update: { isActive: true },
  });
}

function checkCache(lot: { remainingGrams: Prisma.Decimal }, balance: Prisma.Decimal) {
  if (!new Prisma.Decimal(lot.remainingGrams).equals(balance)) {
    throw new HttpError("Batch balance does not match its stock ledger. Reconcile this batch before changing it.", 409);
  }
}

export async function postInventoryMovement(
  tx: InventoryTransaction,
  userId: string,
  input: InventoryMovementInput,
) {
  if (input.action === "OPENING") {
    const grams = new Prisma.Decimal(input.quantityKg).mul(1000);
    if (grams.decimalPlaces() > 5 || !grams.isFinite() || !grams.greaterThan(0)) {
      throw new HttpError("Opening weight exceeds supported stock precision", 400);
    }
    const pounds = input.pounds ? new Prisma.Decimal(input.pounds) : null;
    const density = input.density ? new Prisma.Decimal(input.density) : null;
    if (pounds && (!pounds.isFinite() || !pounds.greaterThan(0))) throw new HttpError("Pounds must be greater than zero", 400);
    if (density && (!density.isFinite() || !density.greaterThan(0))) throw new HttpError("Density must be greater than zero", 400);
    const receivedAt = new Date(input.receivedAt);
    if (receivedAt > new Date()) throw new HttpError("Received date cannot be in the future", 400);
    const rate = new Prisma.Decimal(input.costPerGram);
    if (!rate.isFinite() || rate.isNegative()) throw new HttpError("Cost per gram cannot be negative", 400);
    const storageLocation = await resolveStorageLocation(tx, input.storageLocation, userId);
    const batchNumber = input.batchNumber?.trim() || await generateBatchNumber(tx);
    const lot = await tx.inventoryLot.create({
      data: {
        batchNumber,
        source: input.source,
        receivedAt,
        originalGrams: grams,
        remainingGrams: grams,
        costPerGram: rate,
        purityBps: input.purityBps,
        density,
        pounds,
        status: "ACTIVE",
        storageLocationId: storageLocation.id,
      },
    });
    const movement = await tx.stockMovement.create({
      data: {
        reference: reference("MOV"),
        type: "OPENING_BALANCE",
        inventoryLotId: lot.id,
        locationId: storageLocation.id,
        quantityGrams: grams,
        movementDate: receivedAt,
        reason: input.reason,
        createdById: userId,
      },
    });
    await addAudit(tx, {
      userId,
      action: "inventory.opening.created",
      entity: "InventoryLot",
      entityId: lot.id,
      details: {
        batchNumber,
        quantityGrams: grams.toString(),
        source: input.source,
        location: storageLocation.name,
        movementReference: movement.reference,
        reason: input.reason,
      },
    });
    return { lot, movement };
  }

  const { lot, balance } = await lockedLot(tx, input.lotId);
  if (input.action !== "RECONCILE") checkCache(lot, balance);
  if (input.action !== "RECONCILE" && balance.isNegative()) {
    throw new HttpError("Stock ledger shows a negative batch balance. Reconcile this batch before changing it.", 409);
  }

  if (input.action === "ADJUST") {
    if (lot.status === "QUARANTINED") throw new HttpError("Quarantined stock cannot be adjusted", 409);
    const quantity = new Prisma.Decimal(input.quantityGrams);
    if (quantity.decimalPlaces() > 5 || !quantity.isFinite() || !quantity.greaterThan(0)) {
      throw new HttpError("Adjustment weight exceeds supported stock precision", 400);
    }
    const increase = input.direction === "IN";
    const nextBalance = increase ? balance.plus(quantity) : balance.minus(quantity);
    if (nextBalance.isNegative()) throw new HttpError("Adjustment cannot reduce stock below zero", 409);
    const movement = await tx.stockMovement.create({
      data: {
        reference: reference("MOV"),
        type: increase ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        inventoryLotId: lot.id,
        locationId: lot.storageLocationId,
        quantityGrams: quantity,
        movementDate: new Date(),
        reason: input.reason,
        createdById: userId,
      },
    });
    const updatedLot = await tx.inventoryLot.update({
      where: { id: lot.id },
      data: { remainingGrams: nextBalance, status: nextBalance.isZero() ? "DEPLETED" : "ACTIVE" },
    });
    await addAudit(tx, {
      userId,
      action: "inventory.adjusted",
      entity: "InventoryLot",
      entityId: lot.id,
      details: {
        batchNumber: lot.batchNumber,
        direction: input.direction,
        quantityGrams: quantity.toString(),
        balanceBeforeGrams: balance.toString(),
        balanceAfterGrams: nextBalance.toString(),
        movementReference: movement.reference,
        reason: input.reason,
      },
    });
    return { lot: updatedLot, movement };
  }

  if (input.action === "RECONCILE") {
    const counted = new Prisma.Decimal(input.countedGrams);
    if (!counted.isFinite() || counted.isNegative() || counted.decimalPlaces() > 5) {
      throw new HttpError("Counted weight exceeds supported stock precision", 400);
    }
    const difference = counted.minus(balance);
    if (difference.isZero()) {
      if (new Prisma.Decimal(lot.remainingGrams).equals(counted)) {
        throw new HttpError("Physical count matches the ledger; no correction is needed", 400);
      }
      const repairedLot = await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { remainingGrams: counted, status: lot.status === "QUARANTINED" ? "QUARANTINED" : counted.isZero() ? "DEPLETED" : "ACTIVE" },
      });
      await addAudit(tx, {
        userId,
        action: "inventory.cache.repaired",
        entity: "InventoryLot",
        entityId: lot.id,
        details: {
          batchNumber: lot.batchNumber,
          ledgerBalanceGrams: balance.toString(),
          physicalCountGrams: counted.toString(),
          reason: input.reason,
        },
      });
      return { lot: repairedLot, movement: null };
    }
    const storageLocation = lot.storageLocationId
      ? await tx.storageLocation.findUnique({ where: { id: lot.storageLocationId } })
      : await resolveStorageLocation(tx, "Main storage", userId);
    const movement = await tx.stockMovement.create({
      data: {
        reference: reference("MOV"),
        type: difference.isPositive() ? "STOCK_CORRECTION_IN" : "STOCK_CORRECTION_OUT",
        inventoryLotId: lot.id,
        locationId: storageLocation?.id ?? null,
        quantityGrams: difference.abs(),
        movementDate: new Date(),
        reason: input.reason,
        createdById: userId,
      },
    });
    const updatedLot = await tx.inventoryLot.update({
      where: { id: lot.id },
      data: {
        remainingGrams: counted,
        storageLocationId: storageLocation?.id ?? lot.storageLocationId,
        status: lot.status === "QUARANTINED" ? "QUARANTINED" : counted.isZero() ? "DEPLETED" : "ACTIVE",
      },
    });
    await addAudit(tx, {
      userId,
      action: "inventory.reconciled",
      entity: "InventoryLot",
      entityId: lot.id,
      details: {
        batchNumber: lot.batchNumber,
        ledgerBalanceGrams: balance.toString(),
        physicalCountGrams: counted.toString(),
        correctionGrams: difference.toString(),
        movementReference: movement.reference,
        reason: input.reason,
      },
    });
    return { lot: updatedLot, movement };
  }

  if (lot.status === "QUARANTINED") throw new HttpError("Quarantined stock cannot be transferred", 409);
  const quantity = new Prisma.Decimal(input.quantityGrams);
  if (quantity.decimalPlaces() > 5 || !quantity.isFinite() || !quantity.greaterThan(0)) {
    throw new HttpError("Transfer weight exceeds supported stock precision", 400);
  }
  if (quantity.greaterThan(balance)) throw new HttpError("Transfer cannot exceed the available batch balance", 409);
  const sourceLocation = lot.storageLocationId
    ? await tx.storageLocation.findUnique({ where: { id: lot.storageLocationId } })
    : await resolveStorageLocation(tx, "Main storage", userId);
  if (!sourceLocation) throw new HttpError("The batch has no valid source location", 409);
  const destination = await resolveStorageLocation(tx, input.destinationLocation, userId);
  if (sourceLocation.id === destination.id) throw new HttpError("Choose a different destination location", 400);
  const transferReference = reference("TRF");
  const splitPounds = lot.pounds && new Prisma.Decimal(lot.originalGrams).greaterThan(0)
    ? new Prisma.Decimal(lot.pounds).mul(quantity).div(lot.originalGrams).toDecimalPlaces(8)
    : null;
  const nextSourceBalance = balance.minus(quantity);
  const sourceLot = await tx.inventoryLot.update({
    where: { id: lot.id },
    data: {
      remainingGrams: nextSourceBalance,
      storageLocationId: sourceLocation.id,
      status: nextSourceBalance.isZero() ? "DEPLETED" : "ACTIVE",
    },
  });
  const destinationLot = await tx.inventoryLot.create({
    data: {
      batchNumber: lot.batchNumber,
      source: lot.source,
      receivedAt: lot.receivedAt,
      originalGrams: quantity,
      remainingGrams: quantity,
      costPerGram: lot.costPerGram,
      purityBps: lot.purityBps,
      density: lot.density,
      pounds: splitPounds,
      status: "ACTIVE",
      storageLocationId: destination.id,
    },
  });
  const [outMovement, inMovement] = await Promise.all([
    tx.stockMovement.create({
      data: {
        reference: reference("MOV"),
        type: "TRANSFER_OUT",
        inventoryLotId: lot.id,
        locationId: sourceLocation.id,
        fromLocationId: sourceLocation.id,
        toLocationId: destination.id,
        transferReference,
        quantityGrams: quantity,
        movementDate: new Date(),
        reason: input.reason,
        createdById: userId,
      },
    }),
    tx.stockMovement.create({
      data: {
        reference: reference("MOV"),
        type: "TRANSFER_IN",
        inventoryLotId: destinationLot.id,
        locationId: destination.id,
        fromLocationId: sourceLocation.id,
        toLocationId: destination.id,
        transferReference,
        quantityGrams: quantity,
        movementDate: new Date(),
        reason: input.reason,
        createdById: userId,
      },
    }),
  ]);
  await addAudit(tx, {
    userId,
    action: "inventory.transferred",
    entity: "InventoryLot",
    entityId: lot.id,
    details: {
      transferReference,
      batchNumber: lot.batchNumber,
      quantityGrams: quantity.toString(),
      fromLocation: sourceLocation.name,
      toLocation: destination.name,
      destinationLotId: destinationLot.id,
      movementReferences: [outMovement.reference, inMovement.reference],
      reason: input.reason,
    },
  });
  return { lot: sourceLot, destinationLot, movement: outMovement, transferReference };
}
