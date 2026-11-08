import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { ledgerBalances } from "@/lib/inventory";
import { inventoryStocktakeSchema } from "@/lib/validation";
import { stocktakeVariance } from "@/lib/stocktake";

const zero = () => new Prisma.Decimal(0);

async function getStocktake(id: string) {
  return prisma.inventoryReconciliation.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      lines: { orderBy: [{ batchNumber: "asc" }, { id: "asc" }] },
    },
  });
}

export async function GET() {
  try {
    await requireUser("inventory:read");
    const [active, history] = await Promise.all([
      prisma.inventoryReconciliation.findFirst({
        where: { status: "IN_PROGRESS" },
        orderBy: { startedAt: "desc" },
        include: {
          createdBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          lines: { orderBy: [{ batchNumber: "asc" }, { id: "asc" }] },
        },
      }),
      prisma.inventoryReconciliation.findMany({
        where: { status: { in: ["COMPLETED", "CANCELLED"] } },
        orderBy: { closedAt: "desc" },
        take: 10,
        include: {
          createdBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          lines: { select: { id: true, expectedGrams: true, countedGrams: true, varianceGrams: true } },
        },
      }),
    ]);
    return Response.json({ active, history });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = inventoryStocktakeSchema.parse(await readJson(request));
    const user = await requireUser("inventory:reconcile");
    await enforceUserRateLimit(user.id, "inventory-write", { limit: 20 });

    if (input.action === "START") {
      let reconciliation: { id: string; reference: string };
      let createdNew = false;
      try {
        reconciliation = await prisma.$transaction(async (tx) => {
          const existing = await tx.inventoryReconciliation.findUnique({
            where: { activeKey: "active" },
            select: { id: true, reference: true },
          });
          if (existing) return existing;
          await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM InventoryLot ORDER BY createdAt ASC, id ASC FOR UPDATE`;
          const [lots, groupedMovements] = await Promise.all([
            tx.inventoryLot.findMany({ include: { storageLocation: { select: { name: true } } } }),
            tx.stockMovement.groupBy({
              by: ["inventoryLotId", "type"],
              where: { inventoryLotId: { not: null } },
              _sum: { quantityGrams: true },
            }),
          ]);
          const balances = ledgerBalances(groupedMovements.map((movement) => ({
            inventoryLotId: movement.inventoryLotId,
            type: movement.type,
            quantityGrams: movement._sum.quantityGrams ?? zero(),
          })));
          const countableLots = lots.filter((lot) => {
            const balance = balances.get(lot.id) ?? zero();
            return lot.status !== "DEPLETED" || !balance.isZero() || !balance.equals(lot.remainingGrams);
          });
          if (!countableLots.length) throw new HttpError("There are no stock batches to count", 409);

          const created = await tx.inventoryReconciliation.create({
            data: {
              reference: reference("STK"),
              activeKey: "active",
              createdById: user.id,
              lines: {
                create: countableLots.map((lot) => ({
                  inventoryLotId: lot.id,
                  batchNumber: lot.batchNumber || "Unassigned",
                  locationName: lot.storageLocation?.name ?? "Unassigned",
                  expectedGrams: balances.get(lot.id) ?? zero(),
                  costPerGram: lot.costPerGram,
                })),
              },
            },
            select: { id: true, reference: true },
          });
          await addAudit(tx, {
            userId: user.id,
            action: "inventory.stocktake.started",
            entity: "InventoryReconciliation",
            entityId: created.id,
            details: { reference: created.reference, batchCount: countableLots.length },
          });
          createdNew = true;
          return created;
        }, { timeout: 30_000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const active = await prisma.inventoryReconciliation.findUnique({
          where: { activeKey: "active" },
          select: { id: true, reference: true },
        });
        if (!active) throw error;
        reconciliation = active;
        createdNew = false;
      }
      return Response.json(await getStocktake(reconciliation.id), { status: createdNew ? 201 : 200 });
    }

    if (input.action === "SAVE_COUNTS") {
      const id = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM InventoryReconciliation WHERE id = ${input.reconciliationId} FOR UPDATE`;
        const session = await tx.inventoryReconciliation.findUnique({ where: { id: input.reconciliationId } });
        if (!session || session.status !== "IN_PROGRESS") throw new HttpError("This stocktake is no longer open", 409);
        const ids = input.counts.map((count) => count.lineId);
        if (new Set(ids).size !== ids.length) throw new HttpError("A batch can only be counted once per save", 400);
        const matchingLines = await tx.inventoryReconciliationLine.count({
          where: { reconciliationId: session.id, id: { in: ids } },
        });
        if (matchingLines !== ids.length) throw new HttpError("One or more counted batches do not belong to this stocktake", 400);
        await Promise.all(input.counts.map((count) => tx.inventoryReconciliationLine.update({
          where: { id: count.lineId },
          data: {
            countedGrams: count.countedGrams !== "" ? new Prisma.Decimal(count.countedGrams) : null,
            reason: count.reason.trim() || null,
          },
        })));
        return session.id;
      });
      return Response.json(await getStocktake(id));
    }

    if (input.action === "CANCEL") {
      const id = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM InventoryReconciliation WHERE id = ${input.reconciliationId} FOR UPDATE`;
        const session = await tx.inventoryReconciliation.findUnique({ where: { id: input.reconciliationId } });
        if (!session || session.status !== "IN_PROGRESS") throw new HttpError("This stocktake is no longer open", 409);
        const batchCount = await tx.inventoryReconciliationLine.count({ where: { reconciliationId: session.id } });
        const cancelled = await tx.inventoryReconciliation.update({
          where: { id: session.id },
          data: { status: "CANCELLED", activeKey: null, closedAt: new Date(), closedById: user.id },
          select: { id: true },
        });
        await addAudit(tx, {
          userId: user.id,
          action: "inventory.stocktake.cancelled",
          entity: "InventoryReconciliation",
          entityId: cancelled.id,
          details: { reference: session.reference, batchCount },
        });
        return cancelled.id;
      });
      return Response.json(await getStocktake(id));
    }

    const completedId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM InventoryReconciliation WHERE id = ${input.reconciliationId} FOR UPDATE`;
      const session = await tx.inventoryReconciliation.findUnique({
        where: { id: input.reconciliationId },
        include: { lines: { orderBy: [{ batchNumber: "asc" }, { id: "asc" }] } },
      });
      if (!session || session.status !== "IN_PROGRESS") throw new HttpError("This stocktake is no longer open", 409);
      if (!session.lines.length || session.lines.some((line) => line.countedGrams === null)) {
        throw new HttpError("Enter and save a physical count for every listed batch before completing the stocktake", 400);
      }

      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM InventoryLot ORDER BY createdAt ASC, id ASC FOR UPDATE`;
      const [lots, groupedMovements] = await Promise.all([
        tx.inventoryLot.findMany(),
        tx.stockMovement.groupBy({
          by: ["inventoryLotId", "type"],
          where: { inventoryLotId: { not: null } },
          _sum: { quantityGrams: true },
        }),
      ]);
      const currentBalances = ledgerBalances(groupedMovements.map((movement) => ({
        inventoryLotId: movement.inventoryLotId,
        type: movement.type,
        quantityGrams: movement._sum.quantityGrams ?? zero(),
      })));
      const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
      const sessionLotIds = new Set(session.lines.map((line) => line.inventoryLotId));
      const countableLots = lots.filter((lot) => {
        const balance = currentBalances.get(lot.id) ?? zero();
        return lot.status !== "DEPLETED" || !balance.isZero() || !balance.equals(lot.remainingGrams);
      });
      if (countableLots.length !== sessionLotIds.size || countableLots.some((lot) => !sessionLotIds.has(lot.id))) {
        throw new HttpError("Stock batches changed after this stocktake began. Start a new stocktake to include the latest batches.", 409);
      }
      for (const line of session.lines) {
        const currentBalance = currentBalances.get(line.inventoryLotId) ?? zero();
        if (!currentBalance.equals(line.expectedGrams)) {
          throw new HttpError(`Stock changed for batch ${line.batchNumber} after this stocktake began. Start a new stocktake to avoid overwriting newer activity.`, 409);
        }
        const counted = line.countedGrams!;
        const { varianceGrams } = stocktakeVariance(line.expectedGrams.toString(), counted.toString(), line.costPerGram.toString());
        if (!varianceGrams.isZero() && !line.reason?.trim()) {
          throw new HttpError(`Explain the count difference for batch ${line.batchNumber} before completing the stocktake`, 400);
        }
      }

      for (const line of session.lines) {
        const lot = lotsById.get(line.inventoryLotId);
        if (!lot) throw new HttpError(`Stock batch ${line.batchNumber} no longer exists`, 409);
        const counted = line.countedGrams!;
        const { varianceGrams } = stocktakeVariance(line.expectedGrams.toString(), counted.toString(), line.costPerGram.toString());
        let correctionRef: string | null = null;
        if (!varianceGrams.isZero()) {
          const movement = await tx.stockMovement.create({
            data: {
              reference: reference("MOV"),
              type: varianceGrams.isPositive() ? "STOCK_CORRECTION_IN" : "STOCK_CORRECTION_OUT",
              inventoryLotId: lot.id,
              locationId: lot.storageLocationId,
              quantityGrams: varianceGrams.abs(),
              movementDate: new Date(),
              reason: `Stocktake ${session.reference}: ${line.reason!.trim()}`,
              createdById: user.id,
            },
            select: { reference: true },
          });
          correctionRef = movement.reference;
          await addAudit(tx, {
            userId: user.id,
            action: "inventory.stocktake.variance_posted",
            entity: "InventoryReconciliationLine",
            entityId: line.id,
            details: {
              stocktake: session.reference,
              batchNumber: line.batchNumber,
              expectedGrams: line.expectedGrams.toString(),
              countedGrams: counted.toString(),
              varianceGrams: varianceGrams.toString(),
              correctionReference: movement.reference,
              reason: line.reason,
            },
          });
        }
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: {
            remainingGrams: counted,
            status: lot.status === "QUARANTINED" ? "QUARANTINED" : counted.isZero() ? "DEPLETED" : "ACTIVE",
          },
        });
        await tx.inventoryReconciliationLine.update({
          where: { id: line.id },
          data: { varianceGrams, correctionRef },
        });
      }

      const completed = await tx.inventoryReconciliation.update({
        where: { id: session.id },
        data: { status: "COMPLETED", activeKey: null, closedAt: new Date(), closedById: user.id },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "inventory.stocktake.completed",
        entity: "InventoryReconciliation",
        entityId: completed.id,
        details: {
          reference: session.reference,
          batchCount: session.lines.length,
          varianceCount: session.lines.filter((line) => !line.countedGrams!.equals(line.expectedGrams)).length,
        },
      });
      return completed.id;
    }, { timeout: 30_000 });

    return Response.json(await getStocktake(completedId));
  } catch (error) {
    return apiError(error);
  }
}
