import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buyerFinanceSchema } from "@/lib/validation";
import { calculateBuyerFinanceBalance, recordBuyerFinanceAdvance } from "@/lib/buyer-financing";
import { enforceUserRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await requireUser("payments:read");
    const customerId = new URL(request.url).searchParams.get("customerId") || undefined;
    const accounts = await prisma.buyerFinanceAccount.findMany({
      where: customerId ? { customerId } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: customerId ? undefined : 250,
      include: {
        customer: { select: { id: true, name: true, code: true, isActive: true } },
        payments: {
          orderBy: [{ paidAt: "desc" }, { id: "desc" }],
          include: { cashAccount: { select: { name: true } }, createdBy: { select: { name: true } } },
        },
        settlements: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            trade: { select: { id: true, reference: true, quantityKg: true, purityBps: true, totalAmount: true, transactionDate: true, customer: { select: { name: true, code: true } } } },
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    const data = accounts.map((account) => {
      const payouts = account.payments.filter((payment) => payment.direction === "OUTBOUND")
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
      const gold = account.settlements.reduce((sum, settlement) => sum.plus(settlement.amount), new Prisma.Decimal(0));
      return {
        ...account,
        advanceAmount: payouts.toFixed(2),
        goldAmount: gold.toFixed(2),
        balance: calculateBuyerFinanceBalance(account.payments, account.settlements).toFixed(2),
      };
    });
    return Response.json({ accounts: data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    await enforceUserRateLimit(user.id, "buyer-finance-write", { limit: 20 });
    const input = buyerFinanceSchema.parse(await readJson(request));
    const result = await recordBuyerFinanceAdvance(user.id, input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
