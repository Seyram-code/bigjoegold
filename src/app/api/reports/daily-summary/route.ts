import { FinanceApprovalStatus, PaymentDirection, Prisma } from "@prisma/client";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { calculateBuyerFinanceBalance } from "@/lib/buyer-financing";
import { calculateCashBalances } from "@/lib/finance";
import { calculateCustomerAdvanceBalance } from "@/lib/customer-advance-balance";
import { ledgerBalances } from "@/lib/inventory";
import { splitDailyFinancingPositions } from "@/lib/reporting";

function parseAsOfDate(request: Request) {
  const value = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError("Select a valid summary date", 400);
  }
  const start = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== value) {
    throw new HttpError("Select a valid summary date", 400);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  if (start > new Date()) throw new HttpError("The summary date cannot be in the future", 400);
  return { value, end };
}

const zero = () => new Prisma.Decimal(0);

export async function GET(request: Request) {
  try {
    const user = await requireUser("reports:read");
    const requiredPermissions = ["payments:read", "inventory:read", "customers:personal:read"] as const;
    if (requiredPermissions.some((permission) => !can(user.role, permission, user.permissions))) {
      throw new HttpError("You need payment, inventory, and customer-detail access to view the complete daily summary.", 403);
    }
    const { value: asOfDate, end } = parseAsOfDate(request);
    const [
      cashAccounts,
      cashMovements,
      manualMomoAccounts,
      manualMomoEntries,
      advances,
      buyerFinanceAccounts,
      inventoryLots,
      stockMovements,
      boardPrice,
    ] = await Promise.all([
      prisma.cashAccount.findMany({
        where: { createdAt: { lte: end } },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true, currency: true },
      }),
      prisma.cashMovement.groupBy({
        by: ["accountId", "direction"],
        where: {
          movementDate: { lte: end },
          approvalStatus: { in: [FinanceApprovalStatus.NOT_REQUIRED, FinanceApprovalStatus.APPROVED] },
        },
        _sum: { amount: true },
      }),
      prisma.manualMomoAccount.findMany({
        where: { createdAt: { lte: end } },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true, openingBalance: true, openingDate: true },
      }),
      prisma.manualMomoEntry.groupBy({
        by: ["accountId", "direction"],
        where: { transactionDate: { lte: end } },
        _sum: { amount: true },
      }),
      prisma.customerAdvance.findMany({
        where: { mergedIntoId: null, createdAt: { lte: end } },
        orderBy: [{ customer: { name: "asc" } }, { createdAt: "asc" }],
        select: {
          id: true,
          reference: true,
          openingBalance: true,
          customer: { select: { id: true, name: true, kind: true } },
          payments: {
            where: { paidAt: { lte: end } },
            select: { amount: true, direction: true },
          },
          requests: {
            where: { createdAt: { lte: end } },
            select: {
              fulfillments: {
                where: { createdAt: { lte: end } },
                select: { amount: true },
              },
            },
          },
        },
      }),
      prisma.buyerFinanceAccount.findMany({
        where: { createdAt: { lte: end } },
        orderBy: [{ customer: { name: "asc" } }, { createdAt: "asc" }],
        select: {
          id: true,
          reference: true,
          customer: { select: { id: true, name: true, kind: true } },
          payments: {
            where: { paidAt: { lte: end } },
            select: { amount: true, direction: true },
          },
          settlements: {
            where: { createdAt: { lte: end } },
            select: { amount: true },
          },
        },
      }),
      prisma.inventoryLot.findMany({
        where: { receivedAt: { lte: end } },
        select: {
          id: true,
          purityBps: true,
          costPerGram: true,
        },
      }),
      prisma.stockMovement.findMany({
        where: { movementDate: { lte: end }, inventoryLotId: { not: null } },
        select: { inventoryLotId: true, type: true, quantityGrams: true },
      }),
      prisma.goldBoardPrice.findFirst({
        where: {
          priceType: "SELLING",
          currency: "GHS",
          priceUnit: "GHS_PER_GRAM_PURE_GOLD",
          effectiveAt: { lte: end },
        },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { priceAmount: true, currency: true, priceUnit: true, effectiveAt: true },
      }),
    ]);

    const cashBalanceMap = calculateCashBalances(cashMovements.map((movement) => ({
      accountId: movement.accountId,
      direction: movement.direction,
      amount: movement._sum.amount ?? zero(),
      approvalStatus: FinanceApprovalStatus.APPROVED,
    })));
    const trackedCashAccounts = cashAccounts.map((account) => ({
      ...account,
      balance: (cashBalanceMap.get(account.id) ?? zero()).toNumber(),
    }));

    const manualBalanceMap = new Map<string, Prisma.Decimal>();
    for (const account of manualMomoAccounts) {
      manualBalanceMap.set(
        account.id,
        account.openingDate <= end ? account.openingBalance : zero(),
      );
    }
    for (const entry of manualMomoEntries) {
      const current = manualBalanceMap.get(entry.accountId) ?? zero();
      const amount = entry._sum.amount ?? zero();
      manualBalanceMap.set(
        entry.accountId,
        entry.direction === PaymentDirection.INBOUND ? current.plus(amount) : current.minus(amount),
      );
    }
    const manualAccounts = manualMomoAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: "GHS",
      balance: (manualBalanceMap.get(account.id) ?? zero()).toNumber(),
    }));

    const financingAccounts = [
      ...advances.map((account) => ({
        customerId: account.customer.id,
        customer: account.customer.name,
        customerKind: account.customer.kind,
        type: "Customer gold advance" as const,
        accountReference: account.reference,
        balance: calculateCustomerAdvanceBalance(
          account.openingBalance,
          account.payments,
          account.requests.flatMap((requestItem) => requestItem.fulfillments),
        ).toNumber(),
      })),
      ...buyerFinanceAccounts.map((account) => ({
        customerId: account.customer.id,
        customer: account.customer.name,
        customerKind: account.customer.kind,
        type: "Buyer gold financing" as const,
        accountReference: account.reference,
        balance: calculateBuyerFinanceBalance(account.payments, account.settlements).toNumber(),
      })),
    ];
    const positions = splitDailyFinancingPositions(financingAccounts);

    const inventoryLedger = ledgerBalances(stockMovements.map((movement) => ({
      inventoryLotId: movement.inventoryLotId,
      type: movement.type,
      quantityGrams: movement.quantityGrams,
    })));
    const availableLots = inventoryLots.flatMap((lot) => {
      const grams = inventoryLedger.get(lot.id) ?? zero();
      return grams.greaterThan(0) ? [{ lot, grams }] : [];
    });
    const totalGrams = availableLots.reduce((sum, item) => sum.plus(item.grams), zero());
    const costValue = availableLots.reduce(
      (sum, item) => sum.plus(item.grams.mul(item.lot.costPerGram)),
      zero(),
    );
    const marketValue = boardPrice
      ? availableLots.reduce(
        (sum, item) => sum.plus(item.grams.mul(item.lot.purityBps).div(10000).mul(boardPrice.priceAmount)),
        zero(),
      ).toDecimalPlaces(2)
      : null;

    return Response.json({
      asOfDate,
      generatedAt: new Date().toISOString(),
      trackedCashAccounts,
      manualAccounts,
      receivables: positions.receivables,
      payables: positions.payables,
      inventory: {
        kilograms: totalGrams.div(1000).toNumber(),
        costValue: costValue.toDecimalPlaces(2).toNumber(),
        marketValue: marketValue?.toNumber() ?? null,
        batchCount: availableLots.length,
        boardPrice: boardPrice ? {
          amount: boardPrice.priceAmount.toNumber(),
          currency: boardPrice.currency,
          unit: boardPrice.priceUnit,
          effectiveAt: boardPrice.effectiveAt.toISOString(),
        } : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
