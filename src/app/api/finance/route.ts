import { Prisma } from "@prisma/client";
import { can, requireUser } from "@/lib/authz";
import { calculateCashBalances } from "@/lib/finance";
import { apiError, HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const zero = () => new Prisma.Decimal(0);

export async function GET(request: Request) {
  try {
    const user = await requireUser("reports:read");
    const search = new URL(request.url).searchParams;
    const from = search.get("from") ? new Date(search.get("from")!) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = search.get("to") ? new Date(search.get("to")!) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new HttpError("Provide a valid financial reporting date range", 400);
    }
    to.setHours(23, 59, 59, 999);

    const canReadPayments = can(user.role, "payments:read", user.permissions);
    const [accounts, movements, payments, trades, pendingAdjustments] = await Promise.all([
      prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.cashMovement.groupBy({
        by: ["accountId", "direction"],
        where: { approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] } },
        _sum: { amount: true },
      }),
      canReadPayments ? prisma.payment.findMany({
        where: { paidAt: { gte: from, lte: to } },
        orderBy: { paidAt: "desc" },
        take: 500,
        include: {
          customer: { select: { name: true } },
          trade: { select: { reference: true, type: true } },
          cashAccount: { select: { name: true, currency: true } },
          cashMovement: { select: { id: true, reference: true } },
          createdBy: { select: { name: true } },
        },
      }) : Promise.resolve([]),
      canReadPayments ? prisma.trade.findMany({
        where: { status: { in: ["POSTED", "RETURNED"] } },
        select: {
          id: true,
          reference: true,
          type: true,
          totalAmount: true,
          customer: { select: { name: true } },
          payments: { select: { amount: true, direction: true } },
          advanceFulfillment: { select: { amount: true } },
          buyerFinanceSettlement: { select: { amount: true } },
          corrections: { select: { creditAmount: true, refundAmount: true } },
        },
      }) : Promise.resolve([]),
      prisma.cashMovement.count({ where: { approvalStatus: "PENDING" } }),
    ]);

    const balances = calculateCashBalances(movements.map((movement) => ({
      accountId: movement.accountId,
      direction: movement.direction,
      amount: movement._sum.amount ?? zero(),
      approvalStatus: "APPROVED",
    })));
    const paymentTotals = payments.reduce((totals, payment) => {
      if (payment.direction === "INBOUND") totals.inbound = totals.inbound.plus(payment.amount);
      else totals.outbound = totals.outbound.plus(payment.amount);
      return totals;
    }, { inbound: zero(), outbound: zero() });
    const outstanding = trades.map((trade) => {
      const direction = trade.type === "SALE" ? "INBOUND" : "OUTBOUND";
      const paid = trade.payments.filter((payment) => payment.direction === direction)
        .reduce((sum, payment) => sum.plus(payment.amount), zero());
      const settlements = trade.type === "SALE"
        ? trade.advanceFulfillment?.amount ?? zero()
        : trade.buyerFinanceSettlement?.amount ?? zero();
      const credits = trade.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), zero());
      const refunds = trade.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), zero());
      const balance = trade.type === "SALE"
        ? Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.totalAmount).minus(credits).minus(paid).minus(settlements).plus(refunds))
        : Prisma.Decimal.max(zero(), new Prisma.Decimal(trade.totalAmount).minus(paid).minus(settlements));
      return {
        id: trade.id,
        reference: trade.reference,
        type: trade.type,
        customer: trade.customer?.name ?? "Unspecified",
        amount: trade.totalAmount.toFixed(2),
        balance: balance.toFixed(2),
      };
    }).filter((trade) => new Prisma.Decimal(trade.balance).greaterThan(0));

    return Response.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        incomeReceived: paymentTotals.inbound.toFixed(2),
        cashOut: paymentTotals.outbound.toFixed(2),
        netCashFlow: paymentTotals.inbound.minus(paymentTotals.outbound).toFixed(2),
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          balance: (balances.get(account.id) ?? zero()).toFixed(2),
        })),
        outstandingCustomerBalances: outstanding.filter((item) => item.type === "SALE")
          .reduce((sum, item) => sum.plus(item.balance), zero()).toFixed(2),
        outstandingSupplierBalances: outstanding.filter((item) => item.type === "PURCHASE")
          .reduce((sum, item) => sum.plus(item.balance), zero()).toFixed(2),
        pendingApprovalCount: pendingAdjustments,
      },
      payments,
      outstanding,
      pendingAdjustments: await prisma.cashMovement.findMany({
        where: { approvalStatus: "PENDING" },
        orderBy: { createdAt: "asc" },
        include: { account: { select: { name: true } }, createdBy: { select: { name: true } } },
      }),
      unreconciledPayments: payments.filter((payment) => !payment.cashMovement),
    });
  } catch (error) {
    return apiError(error);
  }
}
