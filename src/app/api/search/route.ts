import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/authz";
import { apiError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireUser("dashboard:read");
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
    if (query.length < 2) return Response.json({ customers: [], trades: [], payments: [] });
    const includeCustomers = can(user.role, "customers:read", user.permissions);
    const mayViewCustomerPersonalData = can(user.role, "customers:personal:read", user.permissions);
    const includeTrades = can(user.role, "trades:read", user.permissions);
    const [customers, trades, payments] = await Promise.all([
      includeCustomers ? prisma.customer.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { code: { contains: query } },
            ...(mayViewCustomerPersonalData ? [{ phone: { contains: query } }] : []),
          ],
          isActive: true,
        },
        select: { id: true, name: true, code: true, ...(mayViewCustomerPersonalData ? { phone: true } : {}) },
        take: 5,
        orderBy: { name: "asc" },
      }) : [],
      includeTrades ? prisma.trade.findMany({
        where: { OR: [{ reference: { contains: query } }, { customer: { name: { contains: query } } }], status: "POSTED" },
        select: { id: true, reference: true, type: true, quantityKg: true, totalAmount: true, createdAt: true, customer: { select: { name: true } } },
        take: 6,
        orderBy: { createdAt: "desc" },
      }) : [],
      includeTrades ? prisma.payment.findMany({
        where: { OR: [{ reference: { contains: query } }, { trade: { reference: { contains: query } } }], trade: { is: { status: "POSTED" } } },
        select: { id: true, reference: true, direction: true, amount: true, method: true, paidAt: true, trade: { select: { reference: true } } },
        take: 4,
        orderBy: { paidAt: "desc" },
      }) : [],
    ]);
    return Response.json({
      customers,
      trades: trades.map((trade) => ({ ...trade, quantityKg: Number(trade.quantityKg), totalAmount: Number(trade.totalAmount) })),
      payments: payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    });
  } catch (error) {
    return apiError(error);
  }
}
