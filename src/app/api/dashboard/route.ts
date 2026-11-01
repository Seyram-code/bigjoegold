import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError } from "@/lib/http";
import { ledgerBalances } from "@/lib/inventory";
import { calculateInventoryAverageKarat, calculateReceivedMeasurementTotals } from "@/lib/dashboard-metrics";

const zero = () => new Prisma.Decimal(0);

function parseDateRange(request: Request, now: Date) {
  const search = new URL(request.url).searchParams;
  const fromValue = search.get("from");
  const toValue = search.get("to");
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const from = fromValue ?? monthStart;
  const to = toValue ?? today;
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(from) || !validDate(to) || from < "1900-01-01" || from > to || to > today) {
    throw new HttpError("Choose a valid date range that ends today or earlier.", 400);
  }
  return {
    fromDate: new Date(`${from}T00:00:00.000Z`),
    toDate: new Date(`${to}T23:59:59.999Z`),
    from,
    to,
  };
}

export async function GET(request: Request) {
  try {
    await requireUser("dashboard:read");
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const { fromDate, toDate, from, to } = parseDateRange(request, now);
    const dailyTrend = (toDate.getTime() - fromDate.getTime()) / 86_400_000 < 366;
    const bucketKey = (date: Date) => {
      if (!dailyTrend) return `${date.toISOString().slice(0, 7)}-01`;
      return date.toISOString().slice(0, 10);
    };
    const [sales, todaySales, purchases, customerCount, lots, stockMovements, currentPrice, receivingPrice, recentTrades, recentPurchases, recentSales, trendTrades, allTrades, recentPayments, recentStockMovements, purchaseMeasurements] =
      await Promise.all([
        prisma.trade.findMany({
          where: { type: "SALE", status: { in: ["POSTED", "RETURNED", "VOIDED"] }, transactionDate: { gte: fromDate, lte: toDate } },
          select: {
            totalAmount: true, costBasis: true, quantityKg: true, transactionDate: true,
            purityBps: true,
            saleMeasurement: {
              select: { topGrams: true, pounds: true, density: true, karat: true },
            },
            corrections: {
              select: {
                quantityGrams: true,
                creditAmount: true,
                allocations: { select: { grams: true, lot: { select: { costPerGram: true } } } },
              },
            },
          },
        }),
        prisma.trade.findMany({
          where: { type: "SALE", status: { in: ["POSTED", "RETURNED", "VOIDED"] }, transactionDate: { gte: todayStart, lte: now } },
          select: {
            totalAmount: true,
            quantityKg: true,
            corrections: { select: { quantityGrams: true, creditAmount: true } },
          },
        }),
        prisma.trade.aggregate({ where: { type: "PURCHASE", status: "POSTED", transactionDate: { gte: fromDate, lte: toDate } }, _sum: { quantityKg: true, totalAmount: true }, _count: true }),
        prisma.customer.count(),
        prisma.inventoryLot.findMany({ select: { id: true, remainingGrams: true, costPerGram: true, purityBps: true, status: true } }),
        prisma.stockMovement.groupBy({
          by: ["inventoryLotId", "type"],
          where: { inventoryLotId: { not: null } },
          _sum: { quantityGrams: true },
        }),
        prisma.goldBoardPrice.findFirst({ where: { priceType: "SELLING", effectiveAt: { lte: now } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
        prisma.goldBoardPrice.findFirst({ where: { priceType: "RECEIVING", effectiveAt: { lte: now } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
        prisma.trade.findMany({
          where: { status: "POSTED" },
          orderBy: { transactionDate: "desc" },
          take: 6,
          include: { customer: { select: { name: true } } },
        }),
        prisma.trade.findMany({ where: { type: "PURCHASE", status: "POSTED" }, orderBy: { transactionDate: "desc" }, take: 5, include: { customer: { select: { name: true } } } }),
        prisma.trade.findMany({ where: { type: "SALE", status: "POSTED" }, orderBy: { transactionDate: "desc" }, take: 5, include: { customer: { select: { name: true } } } }),
        prisma.trade.findMany({
          where: {
            transactionDate: { gte: fromDate, lte: toDate },
            OR: [
              { type: "PURCHASE", status: "POSTED" },
              { type: "SALE", status: { in: ["POSTED", "RETURNED", "VOIDED"] } },
            ],
          },
          select: {
            type: true, status: true, quantityKg: true, totalAmount: true, transactionDate: true,
            corrections: { select: { quantityGrams: true, creditAmount: true } },
          },
        }),
        prisma.trade.findMany({
          where: { OR: [{ type: "PURCHASE", status: "POSTED" }, { type: "SALE", status: { in: ["POSTED", "RETURNED", "VOIDED"] } }] },
          select: {
            type: true, status: true, totalAmount: true,
            payments: { select: { amount: true, direction: true } },
            advanceFulfillment: { select: { amount: true } },
            buyerFinanceSettlement: { select: { amount: true } },
            corrections: { select: { creditAmount: true, refundAmount: true } },
          },
        }),
        prisma.payment.findMany({
          orderBy: { paidAt: "desc" },
          take: 6,
          include: {
            customer: { select: { name: true } },
            trade: { select: { reference: true, type: true } },
            saleCorrection: { select: { reference: true, trade: { select: { reference: true, type: true } } } },
          },
        }),
        prisma.stockMovement.findMany({
          orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
          take: 4,
          include: {
            inventoryLot: { select: { batchNumber: true } },
            location: { select: { name: true } },
            trade: { select: { reference: true, customer: { select: { name: true } } } },
          },
        }),
        prisma.trade.findMany({
          where: { type: "PURCHASE", status: "POSTED", transactionDate: { gte: fromDate, lte: toDate } },
          select: {
            quantityKg: true,
            purityBps: true,
            purchaseMeasurement: { select: { pounds: true, density: true, karat: true } },
          },
        }),
      ]);
    const priceHistory = currentPrice
      ? await prisma.goldBoardPrice.findMany({
        where: { priceType: currentPrice.priceType, currency: currentPrice.currency, priceUnit: currentPrice.priceUnit },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        take: 12,
        select: { priceType: true, priceAmount: true, currency: true, priceUnit: true, effectiveAt: true },
      })
      : [];

    const inventoryLedger = ledgerBalances(stockMovements.map((movement) => ({
      inventoryLotId: movement.inventoryLotId,
      type: movement.type,
      quantityGrams: movement._sum.quantityGrams ?? zero(),
    })));
    const availableLots = lots.filter((lot) => lot.status === "ACTIVE").map((lot) => ({
      ...lot,
      ledgerGrams: inventoryLedger.get(lot.id) ?? zero(),
    })).filter((lot) => lot.ledgerGrams.greaterThan(0));
    const inventoryGrams = availableLots.reduce((sum, lot) => sum.plus(lot.ledgerGrams), zero());
    const inventoryCost = availableLots.reduce((sum, lot) => sum.plus(lot.ledgerGrams.mul(lot.costPerGram)), zero());
    const inventoryAverageKarat = calculateInventoryAverageKarat(availableLots.map((lot) => ({
      grams: lot.ledgerGrams,
      purityBps: lot.purityBps,
    })));
    const receivedMeasurementTotals = calculateReceivedMeasurementTotals(purchaseMeasurements.map((purchase) => ({
      quantityKg: purchase.quantityKg,
      purityBps: purchase.purityBps,
      measurement: purchase.purchaseMeasurement,
    })));
    const inventoryByKarat = new Map<number, Prisma.Decimal>();
    for (const lot of availableLots) {
      const karat = Math.trunc(lot.purityBps * 24 / 10000);
      inventoryByKarat.set(karat, (inventoryByKarat.get(karat) ?? zero()).plus(lot.ledgerGrams));
    }
    const saleRevenue = sales.reduce((sum, sale) => {
      const credit = sale.corrections.reduce((total, correction) => total.plus(correction.creditAmount), zero());
      return sum.plus(new Prisma.Decimal(sale.totalAmount).minus(credit));
    }, zero());
    const salesRevenueToday = todaySales.reduce((sum, sale) => {
      const credit = sale.corrections.reduce((total, correction) => total.plus(correction.creditAmount), zero());
      return sum.plus(new Prisma.Decimal(sale.totalAmount).minus(credit));
    }, zero());
    const saleCostBasis = sales.reduce((sum, sale) => {
      const returnedCost = sale.corrections.reduce((total, correction) =>
        total.plus(correction.allocations.reduce((allocationTotal, allocation) =>
          allocationTotal.plus(new Prisma.Decimal(allocation.grams).mul(allocation.lot.costPerGram)), zero())), zero());
      return sum.plus(Prisma.Decimal.max(zero(), new Prisma.Decimal(sale.costBasis).minus(returnedCost)).toDecimalPlaces(2));
    }, zero());
    const saleQuantityKg = sales.reduce((sum, sale) => {
      const returnedGrams = sale.corrections.reduce((total, correction) => total.plus(correction.quantityGrams), zero());
      return sum.plus(new Prisma.Decimal(sale.quantityKg).minus(returnedGrams.div(1000)));
    }, zero());
    const salesGramsToday = todaySales.reduce((sum, sale) => {
      const returnedGrams = sale.corrections.reduce((total, correction) => total.plus(correction.quantityGrams), zero());
      const soldGrams = Prisma.Decimal.max(zero(), new Prisma.Decimal(sale.quantityKg).mul(1000).minus(returnedGrams));
      return sum.plus(soldGrams);
    }, zero());
    const saleMeasurementTotals = sales.reduce((totals, sale) => {
      const returnedGrams = sale.corrections.reduce((total, correction) => total.plus(correction.quantityGrams), zero());
      const soldGrams = Prisma.Decimal.max(zero(), new Prisma.Decimal(sale.quantityKg).mul(1000).minus(returnedGrams));
      const measurement = sale.saleMeasurement;
      totals.grams = totals.grams.plus(soldGrams);
      if (measurement && new Prisma.Decimal(measurement.topGrams).greaterThan(0)) {
        const remainingRatio = soldGrams.div(measurement.topGrams);
        const measuredGrams = Prisma.Decimal.min(soldGrams, new Prisma.Decimal(measurement.topGrams));
        totals.pounds = totals.pounds.plus(new Prisma.Decimal(measurement.pounds).mul(remainingRatio));
        totals.densityWeight = totals.densityWeight.plus(new Prisma.Decimal(measurement.density).mul(measuredGrams));
        totals.densityGrams = totals.densityGrams.plus(measuredGrams);
        totals.karatWeight = totals.karatWeight.plus(new Prisma.Decimal(measurement.karat).mul(soldGrams));
      } else {
        totals.karatWeight = totals.karatWeight.plus(
          new Prisma.Decimal(sale.purityBps).mul(24).div(10000).mul(soldGrams),
        );
      }
      return totals;
    }, {
      grams: zero(),
      pounds: zero(),
      densityWeight: zero(),
      densityGrams: zero(),
      karatWeight: zero(),
    });
    const receivable = allTrades.filter((trade) => trade.type === "SALE").reduce((sum, trade) => {
      const credit = trade.corrections.reduce((total, correction) => total.plus(correction.creditAmount), zero());
      const refund = trade.corrections.reduce((total, correction) => total.plus(correction.refundAmount), zero());
      const paid = trade.payments.filter((payment) => payment.direction === "INBOUND").reduce((total, payment) => total.plus(payment.amount), zero());
      const advancePaid = trade.advanceFulfillment?.amount ?? zero();
      return sum.plus(new Prisma.Decimal(trade.totalAmount).minus(credit).minus(paid).minus(advancePaid).plus(refund));
    }, zero());
    const payable = allTrades.filter((trade) => trade.type === "PURCHASE").reduce((sum, trade) =>
      sum.plus(new Prisma.Decimal(trade.totalAmount)
        .minus(trade.payments.reduce((paid, payment) => paid.plus(payment.amount), zero()))
        .minus(trade.buyerFinanceSettlement?.amount ?? zero())), zero());
    const trend = new Map<string, { date: string; sales: number; purchases: number; salesKg: number; purchasesKg: number }>();
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const key = bucketKey(cursor);
      if (!trend.has(key)) trend.set(key, { date: key, sales: 0, purchases: 0, salesKg: 0, purchasesKg: 0 });
      if (dailyTrend) cursor.setUTCDate(cursor.getUTCDate() + 1);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    }
    for (const trade of trendTrades) {
      const bucket = trend.get(bucketKey(trade.transactionDate));
      if (bucket) {
        if (trade.type === "SALE") {
          const credited = trade.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), zero());
          const returnedGrams = trade.corrections.reduce((sum, correction) => sum.plus(correction.quantityGrams), zero());
          bucket.sales += Number(new Prisma.Decimal(trade.totalAmount).minus(credited));
          bucket.salesKg += Math.max(0, Number(new Prisma.Decimal(trade.quantityKg).minus(returnedGrams.div(1000))));
        } else {
          bucket.purchases += Number(trade.totalAmount);
          bucket.purchasesKg += Number(trade.quantityKg);
        }
      }
    }
    return Response.json({
      period: { from, to, trendGrouping: dailyTrend ? "day" : "month" },
      summary: {
        salesInPeriod: saleRevenue.toNumber(),
        salesKgInPeriod: saleQuantityKg.toNumber(),
        salesGramsInPeriod: saleMeasurementTotals.grams.toNumber(),
        salesGramsToday: salesGramsToday.toNumber(),
        salesRevenueToday: salesRevenueToday.toNumber(),
        salesPoundsInPeriod: saleMeasurementTotals.pounds.toNumber(),
        salesDensityInPeriod: saleMeasurementTotals.densityGrams.isZero()
          ? null
          : saleMeasurementTotals.densityWeight.div(saleMeasurementTotals.densityGrams).toNumber(),
        salesKaratInPeriod: saleMeasurementTotals.grams.isZero()
          ? null
          : saleMeasurementTotals.karatWeight.div(saleMeasurementTotals.grams).toNumber(),
        grossProfitInPeriod: saleRevenue.minus(saleCostBasis).toNumber(),
        purchasesInPeriod: Number(purchases._sum.totalAmount ?? 0),
        purchasesKgInPeriod: Number(purchases._sum.quantityKg ?? 0),
        purchasesPoundsInPeriod: receivedMeasurementTotals.pounds,
        purchasesDensityInPeriod: receivedMeasurementTotals.density,
        purchasesKaratInPeriod: receivedMeasurementTotals.karat,
        inventoryAverageKarat,
        salesCount: sales.length,
        purchasesCount: purchases._count,
        customerCount,
        inventoryKg: inventoryGrams.div(1000).toNumber(),
        inventoryValue: inventoryCost.toDecimalPlaces(2).toNumber(),
        receivable: receivable.toDecimalPlaces(2).toNumber(),
        payable: payable.toDecimalPlaces(2).toNumber(),
        boardPriceAmount: currentPrice?.priceAmount.toString() ?? null,
        boardPriceCurrency: currentPrice?.currency ?? "GHS",
        boardPriceUnit: currentPrice?.priceUnit ?? null,
        receivingBoardPriceAmount: receivingPrice?.priceAmount.toString() ?? null,
        receivingBoardPriceCurrency: receivingPrice?.currency ?? "GHS",
        receivingBoardPriceUnit: receivingPrice?.priceUnit ?? null,
      },
      trend: [...trend.values()],
      inventoryByKarat: [...inventoryByKarat.entries()]
        .sort(([a], [b]) => b - a)
        .map(([karat, grams]) => ({ karat, kilograms: grams.div(1000).toNumber() })),
      recentTrades: recentTrades.map((trade) => ({
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        quantityKg: Number(trade.quantityKg),
        totalAmount: Number(trade.totalAmount),
        transactionDate: trade.transactionDate,
        customerName: trade.customer?.name ?? "Walk-in",
      })),
      recentPurchases: recentPurchases.map((trade) => ({
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        quantityKg: Number(trade.quantityKg),
        totalAmount: Number(trade.totalAmount),
        transactionDate: trade.transactionDate,
        customerName: trade.customer?.name ?? "Walk-in",
      })),
      recentSales: recentSales.map((trade) => ({
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        quantityKg: Number(trade.quantityKg),
        totalAmount: Number(trade.totalAmount),
        transactionDate: trade.transactionDate,
        customerName: trade.customer?.name ?? "Walk-in",
      })),
      recentPayments: recentPayments.map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        direction: payment.direction,
        amount: Number(payment.amount),
        method: payment.method,
        paidAt: payment.paidAt,
        customerName: payment.customer?.name ?? null,
        allocation: payment.trade?.reference ?? payment.saleCorrection?.trade.reference ?? payment.saleCorrection?.reference ?? "Unallocated",
        tradeType: payment.trade?.type ?? payment.saleCorrection?.trade.type ?? null,
      })),
      recentStockMovements: recentStockMovements.map((movement) => ({
        id: movement.id,
        reference: movement.reference,
        type: movement.type,
        quantityGrams: Number(movement.quantityGrams),
        movementDate: movement.movementDate,
        batchNumber: movement.inventoryLot?.batchNumber ?? null,
        locationName: movement.location?.name ?? null,
        tradeReference: movement.trade?.reference ?? null,
        customerName: movement.trade?.customer?.name ?? null,
      })),
      priceHistory: priceHistory.map((price) => ({
        priceAmount: price.priceAmount.toString(),
        currency: price.currency,
        priceUnit: price.priceUnit,
        effectiveAt: price.effectiveAt,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
