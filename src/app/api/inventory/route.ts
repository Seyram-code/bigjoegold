import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, userCan } from "@/lib/authz";
import { apiError } from "@/lib/http";
import { ledgerBalances } from "@/lib/inventory";
import { calculateAvailableInventoryMeasurementTotals } from "@/lib/dashboard-metrics";
import { purchaseFormulaRules } from "@/lib/purchase-formula";

export async function GET() {
  try {
    const user = await requireUser("inventory:read");
    const [lots, movements, locations, boardPrice, formulaConfig, activeReconciliation, receivingPrices] = await Promise.all([
      prisma.inventoryLot.findMany({
        orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
        include: {
          trade: {
            select: {
              reference: true,
              type: true,
              status: true,
              priceUnit: true,
              pricePerGram: true,
              boardPriceId: true,
              purityBps: true,
              createdAt: true,
              customer: { select: { name: true } },
              purchaseMeasurement: { select: { topKg: true, downKg: true, pounds: true, density: true, karat: true, calculationSource: true, formulaVersion: true } },
              boardPrice: { select: { id: true, priceAmount: true, currency: true, priceUnit: true, effectiveAt: true, source: true } },
              buyerFinanceSettlement: { select: { id: true } },
            },
          },
          storageLocation: { select: { id: true, name: true } },
        },
      }),
      prisma.stockMovement.groupBy({
        by: ["inventoryLotId", "type"],
        where: { inventoryLotId: { not: null } },
        _sum: { quantityGrams: true },
        _count: { _all: true },
      }),
      prisma.storageLocation.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.goldBoardPrice.findFirst({ where: { priceType: "SELLING", effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
      prisma.purchaseFormulaConfig.findUnique({ where: { id: "default" } }),
      prisma.inventoryReconciliation.findFirst({
        where: { status: "IN_PROGRESS" },
        select: { lines: { select: { inventoryLotId: true } } },
      }),
      prisma.goldBoardPrice.findMany({
        where: { priceType: "RECEIVING", currency: "GHS", effectiveAt: { lte: new Date() } },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, priceAmount: true, currency: true, priceUnit: true, effectiveAt: true, source: true },
      }),
    ]);
    const formulaRules = purchaseFormulaRules(formulaConfig);
    const movementGroupsByLot = new Map<string, typeof movements>();
    for (const movement of movements) {
      if (!movement.inventoryLotId) continue;
      movementGroupsByLot.set(movement.inventoryLotId, [...(movementGroupsByLot.get(movement.inventoryLotId) ?? []), movement]);
    }
    const lotsInActiveStocktake = new Set(activeReconciliation?.lines.map((line) => line.inventoryLotId) ?? []);
    const ledger = ledgerBalances(movements.map((movement) => ({
      inventoryLotId: movement.inventoryLotId,
      type: movement.type,
      quantityGrams: movement._sum.quantityGrams ?? new Prisma.Decimal(0),
    })));
    const ledgerLots = lots.map((lot) => {
      const ledgerBalance = ledger.get(lot.id) ?? new Prisma.Decimal(0);
      return {
        ...lot,
        cachedRemainingGrams: lot.remainingGrams,
        remainingGrams: ledgerBalance.toString(),
        ledgerBalanceGrams: ledgerBalance.toString(),
        cacheMismatch: !ledgerBalance.equals(lot.remainingGrams),
        measurementEditable: lot.status === "ACTIVE"
          && ledgerBalance.equals(lot.remainingGrams)
          && ledgerBalance.equals(lot.originalGrams)
          && lot.trade?.type === "PURCHASE"
          && lot.trade.status === "POSTED"
          && lot.trade.purchaseMeasurement?.calculationSource === "CALCULATED"
          && lot.trade.purchaseMeasurement.formulaVersion === formulaRules.version
          && lot.trade.priceUnit === formulaRules.priceUnit
          && formulaRules.ownerConfirmed
          && (!lot.trade.buyerFinanceSettlement || userCan(user, "payments:write"))
          && !lotsInActiveStocktake.has(lot.id)
          && (() => {
            const groups = movementGroupsByLot.get(lot.id) ?? [];
            const allowedTypes = new Set(["PURCHASE_RECEIPT", "MEASUREMENT_CORRECTION_IN", "MEASUREMENT_CORRECTION_OUT"]);
            return groups.some((group) => group.type === "PURCHASE_RECEIPT" && group._count._all === 1)
              && groups.every((group) => allowedTypes.has(group.type));
          })(),
      };
    });
    const availableLots = ledgerLots.filter((lot) => lot.status === "ACTIVE" && new Prisma.Decimal(lot.ledgerBalanceGrams).greaterThan(0));
    const grams = availableLots.reduce((sum, lot) => sum.plus(lot.ledgerBalanceGrams), new Prisma.Decimal(0));
    const value = availableLots.reduce((sum, lot) => sum.plus(new Prisma.Decimal(lot.ledgerBalanceGrams).mul(lot.costPerGram)), new Prisma.Decimal(0));
    const compatibleBoardPrice = boardPrice?.currency === "GHS" && boardPrice.priceUnit === "GHS_PER_GRAM_PURE_GOLD" ? boardPrice : null;
    const marketValue = compatibleBoardPrice
      ? availableLots.reduce((sum, lot) => sum.plus(new Prisma.Decimal(lot.ledgerBalanceGrams).mul(lot.purityBps).div(10000).mul(compatibleBoardPrice.priceAmount)), new Prisma.Decimal(0)).toDecimalPlaces(2)
      : null;
    const weightedPurity = grams.isZero()
      ? 0
      : availableLots.reduce((sum, lot) => sum + Number(lot.ledgerBalanceGrams) * lot.purityBps, 0) / Number(grams);
    const measurementTotals = calculateAvailableInventoryMeasurementTotals(availableLots.map((lot) => ({
      grams: lot.ledgerBalanceGrams,
      originalGrams: lot.originalGrams,
      purityBps: lot.purityBps,
      pounds: lot.pounds,
      density: lot.density,
      measurement: lot.trade?.purchaseMeasurement ?? null,
    })));
    return Response.json({
      summary: {
        kilograms: grams.div(1000).toNumber(),
        grams: grams.toNumber(),
        ...measurementTotals,
        costValue: value.toDecimalPlaces(2).toNumber(),
        marketValue: marketValue?.toNumber() ?? null,
        unrealizedGrossMargin: marketValue ? marketValue.minus(value).toDecimalPlaces(2).toNumber() : null,
        boardPricePerGram: compatibleBoardPrice ? Number(compatibleBoardPrice.priceAmount) : null,
        boardPriceCurrency: boardPrice?.currency ?? null,
        boardPriceUnit: boardPrice?.priceUnit ?? null,
        weightedPurityBps: Math.trunc(weightedPurity),
        batchCount: availableLots.length,
        ledgerMismatchCount: ledgerLots.filter((lot) => lot.cacheMismatch || new Prisma.Decimal(lot.ledgerBalanceGrams).isNegative()).length,
      },
      lots: ledgerLots,
      locations,
      purchaseFormula: formulaRules,
      receivingPrices: receivingPrices.filter((price) => price.priceUnit === formulaRules.priceUnit),
    });
  } catch (error) {
    return apiError(error);
  }
}
