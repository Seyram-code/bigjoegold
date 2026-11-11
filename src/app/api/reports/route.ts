import { Prisma } from "@prisma/client";
import { can, requireUser } from "@/lib/authz";
import { boardPriceUnitLabel } from "@/lib/board-prices";
import { formatPriceAmount } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { apiError, HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { calculateCustomerAdvanceBalance } from "@/lib/customer-advance-balance";
import { buildDailyBuyerFinancingSummary, buildDailyMansoBranchSummary, buildDailySupplierPurchaseSummary, calculateNetProfit, calculateProfitMetrics } from "@/lib/reporting";

const zero = () => new Prisma.Decimal(0);

function parseDateRange(request: Request) {
  const search = new URL(request.url).searchParams;
  const today = new Date();
  const fromValue = search.get("from");
  const toValue = search.get("to");
  const from = fromValue
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(fromValue) ? `${fromValue}T00:00:00.000Z` : fromValue)
    : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = toValue
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(toValue) ? `${toValue}T23:59:59.999Z` : toValue)
    : today;
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new HttpError("Provide a valid date range", 400);
  }
  if (toValue && /^\d{4}-\d{2}-\d{2}$/.test(toValue)) to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function sumAmounts<T extends { amount: Prisma.Decimal }>(items: T[]) {
  return items.reduce((sum, item) => sum.plus(item.amount), zero());
}

export async function GET(request: Request) {
  try {
    const user = await requireUser("reports:read");
    const { from, to } = parseDateRange(request);
    const readInventory = can(user.role, "inventory:read", user.permissions);
    const readPayments = can(user.role, "payments:read", user.permissions);
    const readBoard = can(user.role, "board:read", user.permissions);
    const readStaff = can(user.role, "staff:read", user.permissions);
    const readCustomerDetails = can(user.role, "customers:personal:read", user.permissions);

    const [
      trades,
      inventoryLots,
      payments,
      cashMovements,
      stockMovements,
      boardPrices,
      allOpenTrades,
      financingPayments,
      advanceFulfillments,
      buyerFinanceSettlements,
      customerAdvanceAccounts,
      buyerFinanceAccounts,
      paymentAccounts,
      mansoBranch,
    ] = await Promise.all([
      prisma.trade.findMany({
        where: {
          transactionDate: { gte: from, lte: to },
          OR: [
            { type: "PURCHASE", status: "POSTED" },
            { type: "SALE", status: { in: ["POSTED", "RETURNED"] } },
          ],
        },
        orderBy: { transactionDate: "asc" },
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          totalAmount: true,
          costBasis: true,
          quantityKg: true,
          purityBps: true,
          transactionDate: true,
          customer: { select: { id: true, code: true, name: true } },
          purchaseMeasurement: { select: { calculationSource: true } },
          createdBy: { select: { name: true } },
          payments: { select: { amount: true, direction: true } },
          advanceFulfillment: { select: { amount: true } },
          buyerFinanceSettlement: { select: { amount: true } },
          corrections: {
            select: {
              quantityGrams: true,
              creditAmount: true,
              refundAmount: true,
              allocations: {
                select: { grams: true, lot: { select: { costPerGram: true } } },
              },
            },
          },
        },
      }),
      readInventory
        ? prisma.inventoryLot.findMany({
          where: { remainingGrams: { gt: 0 } },
          orderBy: [{ batchNumber: "asc" }, { receivedAt: "asc" }],
          include: { storageLocation: { select: { name: true } } },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.payment.findMany({
          where: { paidAt: { gte: from, lte: to } },
          orderBy: { paidAt: "asc" },
          select: {
            id: true,
            reference: true,
            direction: true,
            amount: true,
            method: true,
            paidAt: true,
            note: true,
            customer: { select: { name: true } },
            trade: { select: { reference: true, type: true } },
            cashAccount: { select: { id: true, name: true } },
            createdBy: { select: { name: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.cashMovement.findMany({
          where: { movementDate: { gte: from, lte: to } },
          orderBy: { movementDate: "asc" },
          select: {
            id: true,
            reference: true,
            type: true,
            direction: true,
            amount: true,
            movementDate: true,
            description: true,
            expenseCategory: true,
            approvalStatus: true,
            account: { select: { name: true, currency: true } },
            createdBy: { select: { name: true } },
          },
        })
        : Promise.resolve(null),
      readInventory
        ? prisma.stockMovement.findMany({
          where: { movementDate: { gte: from, lte: to } },
          orderBy: { movementDate: "asc" },
          select: {
            id: true,
            reference: true,
            type: true,
            quantityGrams: true,
            movementDate: true,
            reason: true,
            inventoryLot: { select: { batchNumber: true } },
            location: { select: { name: true } },
            fromLocation: { select: { name: true } },
            toLocation: { select: { name: true } },
            createdBy: { select: { name: true } },
          },
        })
        : Promise.resolve(null),
      readBoard
        ? prisma.goldBoardPrice.findMany({
          where: { effectiveAt: { gte: from, lte: to } },
          orderBy: { effectiveAt: "asc" },
          select: {
            id: true,
            priceType: true,
            priceAmount: true,
            currency: true,
            priceUnit: true,
            source: true,
            note: true,
            effectiveAt: true,
            createdBy: { select: { name: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.trade.findMany({
          where: { status: { in: ["POSTED", "RETURNED"] } },
          select: {
            id: true,
            reference: true,
            type: true,
            totalAmount: true,
            quantityKg: true,
            transactionDate: true,
            purchaseMeasurement: { select: { calculationSource: true } },
            customer: { select: { name: true } },
            payments: { select: { amount: true, direction: true, paidAt: true } },
            advanceFulfillment: { select: { amount: true } },
            buyerFinanceSettlement: { select: { amount: true, createdAt: true } },
            corrections: { select: { creditAmount: true, refundAmount: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.payment.findMany({
          where: {
            paidAt: { gte: from, lte: to },
            OR: [{ customerAdvanceId: { not: null } }, { buyerFinanceAccountId: { not: null } }],
          },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            reference: true,
            direction: true,
            amount: true,
            paidAt: true,
            customer: { select: { id: true, name: true } },
            customerAdvance: { select: { reference: true } },
            buyerFinanceAccount: { select: { reference: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.advanceFulfillment.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            reference: true,
            amount: true,
            createdAt: true,
            request: {
              select: {
                advance: {
                  select: {
                    reference: true,
                    customer: { select: { id: true, name: true } },
                  },
                },
              },
            },
            trade: { select: { reference: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.buyerFinanceSettlement.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            reference: true,
            amount: true,
            createdAt: true,
            account: {
              select: {
                reference: true,
                customer: { select: { id: true, name: true } },
              },
            },
            trade: { select: { reference: true } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.customerAdvance.findMany({
          where: { mergedIntoId: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            reference: true,
            createdAt: true,
            openingBalance: true,
            note: true,
            customer: { select: { id: true, name: true, kind: true } },
            payments: { select: { amount: true, direction: true } },
            requests: { select: { fulfillments: { select: { amount: true } } } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.buyerFinanceAccount.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            reference: true,
            customer: { select: { id: true, name: true } },
            payments: { select: { amount: true, direction: true, paidAt: true } },
            settlements: { select: { amount: true, createdAt: true, trade: { select: { quantityKg: true } } } },
          },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.cashAccount.findMany({
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          select: { id: true, name: true, type: true, currency: true, isActive: true },
        })
        : Promise.resolve(null),
      readPayments
        ? prisma.mansoBranch.findUnique({ where: { id: "manso" }, select: { cashAccountId: true } })
        : Promise.resolve(null),
    ]);
    const mansoMovements = mansoBranch
      ? await prisma.cashMovement.findMany({
        where: { accountId: mansoBranch.cashAccountId, movementDate: { lte: to } },
        orderBy: [{ movementDate: "asc" }, { id: "asc" }],
        select: {
          movementDate: true,
          type: true,
          direction: true,
          amount: true,
          approvalStatus: true,
          payment: {
            select: {
              trade: {
                select: {
                  purchaseMeasurement: { select: { calculationSource: true } },
                },
              },
            },
          },
        },
      })
      : [];

    const financingRows = readPayments ? [
      ...(financingPayments ?? []).map((payment) => {
        const isCustomerAdvance = Boolean(payment.customerAdvance);
        const isOutbound = payment.direction === "OUTBOUND";
        return {
          id: payment.id,
          date: payment.paidAt.toISOString(),
          type: isCustomerAdvance ? "Customer gold advance" : "Buyer gold financing",
          accountReference: payment.customerAdvance?.reference ?? payment.buyerFinanceAccount?.reference ?? "",
          reference: payment.reference,
          relatedReference: "",
          activity: isCustomerAdvance
            ? isOutbound ? "Refund paid" : "Funds received"
            : isOutbound ? "Cash advance paid" : "Cash returned",
          amount: payment.amount.toNumber(),
          customerId: can(user.role, "customers:read", user.permissions) ? payment.customer?.id ?? null : null,
          customer: readCustomerDetails ? payment.customer?.name ?? "Unspecified" : payment.customer ? "Restricted customer" : "Unspecified",
        };
      }),
      ...(advanceFulfillments ?? []).map((fulfillment) => ({
        id: fulfillment.id,
        date: fulfillment.createdAt.toISOString(),
        type: "Customer gold advance",
        accountReference: fulfillment.request.advance.reference,
        reference: fulfillment.reference,
        relatedReference: fulfillment.trade.reference,
        activity: "Gold released",
        amount: fulfillment.amount.toNumber(),
        customerId: can(user.role, "customers:read", user.permissions) ? fulfillment.request.advance.customer.id : null,
        customer: readCustomerDetails ? fulfillment.request.advance.customer.name : "Restricted customer",
      })),
      ...(customerAdvanceAccounts ?? [])
        .filter((account) => !account.openingBalance.isZero() && account.createdAt >= from && account.createdAt <= to)
        .map((account) => ({
          id: `${account.id}-opening-balance`,
          date: account.createdAt.toISOString(),
          type: "Customer gold advance",
          accountReference: account.reference,
          reference: account.reference,
          relatedReference: "",
          activity: account.openingBalance.lessThan(0) ? "Opening balance — supplier owes Big Joe" : "Opening balance — credit owed to supplier",
          amount: account.openingBalance.abs().toNumber(),
          customerId: can(user.role, "customers:read", user.permissions) ? account.customer.id : null,
          customer: readCustomerDetails ? account.customer.name : "Restricted customer",
        })),
      ...(buyerFinanceSettlements ?? []).map((settlement) => ({
        id: settlement.id,
        date: settlement.createdAt.toISOString(),
        type: "Buyer gold financing",
        accountReference: settlement.account.reference,
        reference: settlement.reference,
        relatedReference: settlement.trade.reference,
        activity: "Gold purchase settled",
        amount: settlement.amount.toNumber(),
        customerId: can(user.role, "customers:read", user.permissions) ? settlement.account.customer.id : null,
        customer: readCustomerDetails ? settlement.account.customer.name : "Restricted customer",
      })),
    ].sort((left, right) => left.date.localeCompare(right.date)) : null;
    const financingAccounts = readPayments ? [
      ...(customerAdvanceAccounts ?? []).map((account) => {
        return {
          id: account.id,
          type: "Customer gold advance",
          accountReference: account.reference,
          customerId: can(user.role, "customers:read", user.permissions) ? account.customer.id : null,
          customer: readCustomerDetails ? account.customer.name : "Restricted customer",
          balance: calculateCustomerAdvanceBalance(
            account.openingBalance,
            account.payments,
            account.requests.flatMap((request) => request.fulfillments),
          ).toNumber(),
          balanceMeaning: account.customer.kind === "SUPPLIER"
            ? "Negative: supplier owes Big Joe; positive: credit owed to supplier"
            : "Positive: customer credit; negative: customer owes Big Joe",
        };
      }),
      ...(buyerFinanceAccounts ?? []).map((account) => {
        const payouts = account.payments.reduce((sum, payment) => sum.plus(
          payment.direction === "OUTBOUND" ? payment.amount : payment.amount.negated(),
        ), zero());
        const settlements = account.settlements.reduce((sum, settlement) => sum.plus(settlement.amount), zero());
        return {
          id: account.id,
          type: "Buyer gold financing",
          accountReference: account.reference,
          customerId: can(user.role, "customers:read", user.permissions) ? account.customer.id : null,
          customer: readCustomerDetails ? account.customer.name : "Restricted customer",
          balance: payouts.minus(settlements).toNumber(),
          balanceMeaning: "Positive: customer owes Big Joe; negative: Big Joe owes customer",
        };
      }),
    ].sort((left, right) => left.customer.localeCompare(right.customer)) : null;
    const buyerFinancingDailySummary = readPayments
      ? buildDailyBuyerFinancingSummary((buyerFinanceAccounts ?? []).map((account) => ({
        customerId: account.customer.id,
        customer: readCustomerDetails ? account.customer.name : "Restricted customer",
        payments: account.payments.map((payment) => ({
          amount: payment.amount.toNumber(),
          direction: payment.direction,
          paidAt: payment.paidAt.toISOString(),
        })),
        settlements: account.settlements.map((settlement) => ({
          amount: settlement.amount.toNumber(),
          createdAt: settlement.createdAt.toISOString(),
          quantityKg: settlement.trade.quantityKg.toNumber(),
        })),
      })), from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
      : null;
    const supplierDailySummary = readPayments
      ? buildDailySupplierPurchaseSummary((allOpenTrades ?? [])
        .filter((trade) => trade.type === "PURCHASE")
        .filter((trade) => trade.purchaseMeasurement?.calculationSource !== "MANSO_MANUAL_COST")
        .map((trade) => ({
          transactionDate: trade.transactionDate.toISOString(),
          quantityKg: trade.quantityKg.toNumber(),
          totalAmount: trade.totalAmount.toNumber(),
          payments: trade.payments.map((payment) => ({
            amount: payment.amount.toNumber(),
            direction: payment.direction,
            paidAt: payment.paidAt.toISOString(),
          })),
          settlements: trade.buyerFinanceSettlement ? [{
            amount: trade.buyerFinanceSettlement.amount.toNumber(),
            createdAt: trade.buyerFinanceSettlement.createdAt.toISOString(),
          }] : [],
        })), from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
      : null;
    const mansoDailySummary = readPayments
      ? buildDailyMansoBranchSummary(mansoMovements.map((movement) => ({
        movementDate: movement.movementDate.toISOString(),
        type: movement.type,
        direction: movement.direction,
        amount: movement.amount.toNumber(),
        approvalStatus: movement.approvalStatus,
        isGoldPurchasePayment: movement.payment?.trade?.purchaseMeasurement?.calculationSource === "MANSO_MANUAL_COST",
      })), from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
      : null;

    const tradeRows = trades.map((trade) => {
      const credits = trade.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), zero());
      const returnedGrams = trade.corrections.reduce((sum, correction) => sum.plus(correction.quantityGrams), zero());
      const paid = trade.payments
        .filter((payment) => payment.direction === (trade.type === "SALE" ? "INBOUND" : "OUTBOUND"))
        .reduce((sum, payment) => sum.plus(payment.amount), zero());
      const totalPaid = paid.plus(trade.type === "SALE"
        ? trade.advanceFulfillment?.amount ?? 0
        : trade.buyerFinanceSettlement?.amount ?? 0);
      const adjustedAmount = Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.totalAmount).minus(credits));
      const returnedCost = trade.corrections.reduce((correctionSum, correction) =>
        correctionSum.plus(correction.allocations.reduce((allocationSum, allocation) =>
          allocationSum.plus(new Prisma.Decimal(allocation.grams).mul(allocation.lot.costPerGram)), zero())), zero());
      const costAfterReturns = Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.costBasis).minus(returnedCost));
      const profitMetrics = trade.type === "SALE" && new Prisma.Decimal(trade.costBasis).greaterThan(0)
        ? calculateProfitMetrics(adjustedAmount.toFixed(2), costAfterReturns.toFixed(2))
        : null;
      const balance = trade.type === "SALE"
        ? Prisma.Decimal.max(zero(), adjustedAmount.minus(totalPaid).plus(
          trade.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), zero()),
        ))
        : Prisma.Decimal.max(zero(), adjustedAmount.minus(totalPaid));
      return {
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        status: trade.status,
        transactionDate: trade.transactionDate.toISOString(),
        quantityKg: Math.max(0, new Prisma.Decimal(trade.quantityKg).minus(returnedGrams.div(1000)).toNumber()),
        purityBps: trade.purityBps,
        karat: Number(formatDecimalTruncated((trade.purityBps / 10000) * 24, 2)),
        totalAmount: trade.totalAmount.toNumber(),
        netAmount: adjustedAmount.toNumber(),
        costBasis: trade.costBasis.toNumber(),
        profit: profitMetrics ? adjustedAmount.minus(costAfterReturns).toNumber() : null,
        grossMargin: profitMetrics?.grossMargin ?? null,
        returnOnCost: profitMetrics?.returnOnCost ?? null,
        paidAmount: totalPaid.toNumber(),
        balance: balance.toNumber(),
        customerId: readCustomerDetails ? trade.customer?.id ?? null : null,
        customer: trade.type === "PURCHASE" && trade.purchaseMeasurement?.calculationSource === "MANSO_MANUAL_COST"
          ? "Manso Branch"
          : readCustomerDetails ? trade.customer?.name ?? "Unspecified" : trade.customer ? "Restricted customer" : "Unspecified",
        customerCode: readCustomerDetails ? trade.customer?.code ?? "" : "",
        createdBy: readStaff ? trade.createdBy.name : "",
      };
    });

    const sales = trades.filter((trade) => trade.type === "SALE");
    const purchases = trades.filter((trade) => trade.type === "PURCHASE");
    const salesValue = sales.reduce((sum, trade) => sum.plus(trade.totalAmount)
      .minus(trade.corrections.reduce((credit, correction) => credit.plus(correction.creditAmount), zero())), zero());
    const purchaseValue = purchases.reduce((sum, trade) => sum.plus(trade.totalAmount), zero());
    const costOfSales = sales.reduce((sum, trade) => {
      const returnedCost = trade.corrections.reduce((correctionSum, correction) =>
        correctionSum.plus(correction.allocations.reduce((allocationSum, allocation) =>
          allocationSum.plus(new Prisma.Decimal(allocation.grams).mul(allocation.lot.costPerGram)), zero())), zero());
      return sum.plus(Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.costBasis).minus(returnedCost)));
    }, zero());
    const inbound = (payments ?? []).filter((payment) => payment.direction === "INBOUND");
    const outbound = (payments ?? []).filter((payment) => payment.direction === "OUTBOUND");
    const cashIn = sumAmounts(inbound);
    const expenses = cashMovements?.filter((movement) => movement.type === "EXPENSE") ?? null;
    const approvedExpenses = expenses?.filter((movement) => ["NOT_REQUIRED", "APPROVED"].includes(movement.approvalStatus)) ?? [];
    const expensesValue = approvedExpenses.reduce((sum, movement) => sum.plus(movement.amount), zero());
    const cashOut = sumAmounts(outbound).plus(expensesValue);
    const costBasisComplete = sales.every((trade) => new Prisma.Decimal(trade.costBasis).greaterThan(0));
    const overallProfitMetrics = calculateProfitMetrics(salesValue.toFixed(2), costOfSales.toFixed(2));
    const profit = costBasisComplete ? salesValue.minus(costOfSales).toNumber() : null;
    const netProfit = expenses
      ? calculateNetProfit(profit, approvedExpenses.map((movement) => movement.amount.toFixed(2)))
      : null;

    const inventoryRows = inventoryLots?.map((lot) => ({
      id: lot.id,
      batchNumber: lot.batchNumber || "Unassigned",
      source: lot.source || "Unspecified",
      receivedAt: lot.receivedAt.toISOString(),
      remainingGrams: lot.remainingGrams.toNumber(),
      remainingKg: lot.remainingGrams.div(1000).toNumber(),
      purityBps: lot.purityBps,
      karat: Number(formatDecimalTruncated((lot.purityBps / 10000) * 24, 2)),
      costPerGram: lot.costPerGram.toNumber(),
      bookValue: lot.remainingGrams.mul(lot.costPerGram).toNumber(),
      status: lot.status,
      location: lot.storageLocation?.name ?? "Unassigned",
    })) ?? null;
    const inventoryValue = inventoryLots?.reduce((sum, lot) =>
      sum.plus(lot.remainingGrams.mul(lot.costPerGram)), zero()).toNumber() ?? null;

    const outstandingTrades = allOpenTrades?.map((trade) => {
      const paid = trade.payments
        .filter((payment) => payment.direction === (trade.type === "SALE" ? "INBOUND" : "OUTBOUND"))
        .reduce((sum, payment) => sum.plus(payment.amount), zero());
      const totalPaid = paid.plus(trade.type === "SALE"
        ? trade.advanceFulfillment?.amount ?? 0
        : trade.buyerFinanceSettlement?.amount ?? 0);
      const credit = trade.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), zero());
      const refund = trade.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), zero());
      const balance = trade.type === "SALE"
        ? Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.totalAmount).minus(credit).minus(totalPaid).plus(refund))
        : Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.totalAmount).minus(totalPaid));
      return {
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        customer: readCustomerDetails ? trade.customer?.name ?? "Unspecified" : trade.customer ? "Restricted customer" : "Unspecified",
        amount: trade.totalAmount.toNumber(),
        balance: balance.toNumber(),
      };
    }).filter((trade) => trade.balance > 0) ?? null;
    const activity = readStaff ? [
      ...trades.map((trade) => ({
        date: trade.transactionDate.toISOString(),
        staff: trade.createdBy.name,
        activity: `${trade.type.toLowerCase()} recorded`,
        reference: trade.reference,
      })),
      ...(payments ?? []).map((payment) => ({
        date: payment.paidAt.toISOString(),
        staff: payment.createdBy.name,
        activity: `${payment.direction.toLowerCase()} payment recorded`,
        reference: payment.reference,
      })),
      ...(stockMovements ?? []).map((movement) => ({
        date: movement.movementDate.toISOString(),
        staff: movement.createdBy.name,
        activity: `stock ${movement.type.toLowerCase().replaceAll("_", " ")}`,
        reference: movement.reference,
      })),
      ...(boardPrices ?? []).map((price) => ({
        date: price.effectiveAt.toISOString(),
        staff: price.createdBy.name,
        activity: "board price published",
        reference: price.id,
      })),
    ].sort((left, right) => left.date.localeCompare(right.date)) : null;

    return Response.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        sales: salesValue.toNumber(),
        purchases: purchaseValue.toNumber(),
        costOfSales: costOfSales.toNumber(),
        profit,
        expenses: expenses ? expensesValue.toNumber() : null,
        netProfit,
        grossMargin: costBasisComplete ? overallProfitMetrics.grossMargin : null,
        returnOnCost: costBasisComplete ? overallProfitMetrics.returnOnCost : null,
        cashIn: cashIn.toNumber(),
        cashOut: cashOut.toNumber(),
        netCashFlow: cashIn.minus(cashOut).toNumber(),
        purchasedKg: purchases.reduce((sum, trade) => sum + Number(trade.quantityKg), 0),
        soldKg: tradeRows.filter((trade) => trade.type === "SALE").reduce((sum, trade) => sum + trade.quantityKg, 0),
        tradeCount: trades.length,
        inventoryValue,
        inventoryKg: inventoryRows?.reduce((sum, lot) => sum + lot.remainingKg, 0) ?? null,
      },
      profitAvailability: {
        costBasisComplete,
        method: "Profit is net sales value minus the recorded receiving cost of the stock allocated to gold sold or released. Gross margin is profit divided by sales value; return on cost is profit divided by receiving cost.",
        explanation: profit === null
          ? "Profit is unavailable because a cost basis is missing for one or more sales."
          : "Profit is recognized only for gold sold or released. Partial sales use the receiving cost of the grams allocated from each stock batch; unsold gold remains inventory.",
      },
      trades: tradeRows,
      inventory: inventoryRows,
      payments: payments?.map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        direction: payment.direction,
        amount: payment.amount.toNumber(),
        method: payment.method,
        accountId: payment.cashAccount?.id ?? null,
        paidAt: payment.paidAt.toISOString(),
        customer: readCustomerDetails ? payment.customer?.name ?? "Unspecified" : payment.customer ? "Restricted customer" : "Unspecified",
        tradeReference: payment.trade?.reference ?? "",
        tradeType: payment.trade?.type ?? "",
        account: payment.cashAccount?.name ?? "Unassigned",
        createdBy: readStaff ? payment.createdBy.name : "",
        note: payment.note ?? "",
      })) ?? null,
      paymentAccounts,
      outstandingTrades,
      cashMovements: cashMovements?.map((movement) => ({
        id: movement.id,
        reference: movement.reference,
        type: movement.type,
        direction: movement.direction,
        amount: movement.amount.toNumber(),
        movementDate: movement.movementDate.toISOString(),
        account: `${movement.account.name} (${movement.account.currency})`,
        approvalStatus: movement.approvalStatus,
        description: movement.description ?? "",
        expenseCategory: movement.expenseCategory?.replaceAll("_", " ") ?? "",
        createdBy: readStaff ? movement.createdBy.name : "",
      })) ?? null,
      expenses: expenses?.map((movement) => ({
        id: movement.id,
        reference: movement.reference,
        movementDate: movement.movementDate.toISOString(),
        category: movement.expenseCategory?.replaceAll("_", " ") ?? "Other",
        account: movement.account.name,
        amount: movement.amount.toNumber(),
        approvalStatus: movement.approvalStatus.replaceAll("_", " "),
        description: movement.description ?? "",
        createdBy: readStaff ? movement.createdBy.name : "",
      })) ?? null,
      stockMovements: stockMovements?.map((movement) => ({
        id: movement.id,
        reference: movement.reference,
        type: movement.type,
        quantityGrams: movement.quantityGrams.toNumber(),
        quantityKg: movement.quantityGrams.div(1000).toNumber(),
        movementDate: movement.movementDate.toISOString(),
        batchNumber: movement.inventoryLot?.batchNumber ?? "Unassigned",
        location: movement.location?.name ?? "",
        transfer: [movement.fromLocation?.name, movement.toLocation?.name].filter(Boolean).join(" -> "),
        reason: movement.reason ?? "",
        createdBy: readStaff ? movement.createdBy.name : "",
      })) ?? null,
      staffActivity: activity,
      boardPrices: boardPrices?.map((price) => ({
        id: price.id,
        priceType: price.priceType,
        effectiveAt: price.effectiveAt.toISOString(),
        priceAmount: price.priceAmount.toNumber(),
        quotedRate: `${formatPriceAmount(price.priceAmount.toString(), price.currency)} / ${boardPriceUnitLabel(price.priceUnit)}`,
        direction: price.priceType === "RECEIVING" ? "Receiving stock" : "Releasing / selling",
        currency: price.currency,
        priceUnit: price.priceUnit,
        source: price.source,
        note: price.note ?? "",
        createdBy: readStaff ? price.createdBy.name : "",
      })) ?? null,
      financing: financingRows,
      financingAccounts,
      supplierDailySummary,
      mansoDailySummary,
      buyerFinancingDailySummary,
    });
  } catch (error) {
    return apiError(error);
  }
}
