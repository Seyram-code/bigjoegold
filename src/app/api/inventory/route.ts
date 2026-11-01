import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { apiError } from "@/lib/http";
import { ledgerBalances } from "@/lib/inventory";

export async function GET() {
  try {
    await requireUser("inventory:read");
    const [lots, movements, locations, boardPrice] = await Promise.all([
      prisma.inventoryLot.findMany({
        orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
        include: {
          trade: { select: { reference: true, purityBps: true, createdAt: true, customer: { select: { name: true } } } },
          storageLocation: { select: { id: true, name: true } },
        },
      }),
      prisma.stockMovement.groupBy({
        by: ["inventoryLotId", "type"],
        where: { inventoryLotId: { not: null } },
        _sum: { quantityGrams: true },
      }),
      prisma.storageLocation.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.goldBoardPrice.findFirst({ where: { priceType: "SELLING", effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
    ]);
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
    return Response.json({
      summary: {
        kilograms: grams.div(1000).toNumber(),
        grams: grams.toNumber(),
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
    });
  } catch (error) {
    return apiError(error);
  }
}
