import { Prisma } from "@prisma/client";
import { requireUser, userCan } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { postSale } from "@/lib/sales";
import { recordCustomerAdvance } from "@/lib/customer-advances";
import { customerAdvanceSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await requireUser("payments:read");
    const customerId = new URL(request.url).searchParams.get("customerId") || undefined;
    const [advances, currentBoardPrice] = await Promise.all([prisma.customerAdvance.findMany({
      where: customerId ? { customerId } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: customerId ? undefined : 250,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        createdBy: { select: { name: true } },
        payments: {
          orderBy: [{ paidAt: "desc" }, { id: "desc" }],
          include: {
            cashAccount: { select: { name: true } },
            createdBy: { select: { name: true } },
          },
        },
        requests: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            createdBy: { select: { name: true } },
            fulfillments: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              include: {
                trade: { select: { id: true, reference: true, transactionDate: true } },
                boardPrice: { select: { source: true, effectiveAt: true } },
                createdBy: { select: { name: true } },
              },
            },
          },
        },
      },
    }), prisma.goldBoardPrice.findFirst({
      where: { priceType: "SELLING", currency: "GHS", priceUnit: "GHS_PER_GRAM_PURE_GOLD", effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    })]);
    const data = advances.map((advance) => {
      const received = advance.payments.filter((payment) => payment.direction === "INBOUND")
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
      const refunded = advance.payments.filter((payment) => payment.direction === "OUTBOUND")
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
      const fulfilled = advance.requests.flatMap((request) => request.fulfillments)
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      return {
        ...advance,
        receivedAmount: received.toFixed(2),
        refundedAmount: refunded.toFixed(2),
        fulfilledAmount: fulfilled.toFixed(2),
        balance: received.minus(refunded).minus(fulfilled).toFixed(2),
        requests: advance.requests.map((request) => {
          const fulfilledGrams = request.fulfillments.reduce((sum, item) => sum.plus(item.grams), new Prisma.Decimal(0));
          return {
            ...request,
            fulfilledGrams: fulfilledGrams.toFixed(5),
            remainingGrams: Prisma.Decimal.max(new Prisma.Decimal(request.requestedGrams).minus(fulfilledGrams), 0).toFixed(5),
          };
        }),
      };
    });
    return Response.json({ advances: data, currentBoardPrice });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    await enforceUserRateLimit(user.id, "customer-advance-write", { limit: 20 });
    const input = customerAdvanceSchema.parse(await readJson(request));
    if (input.action === "FULFILL") {
      if (!userCan(user, "sales:write")) throw new Response("You do not have permission to fulfill gold requests", { status: 403 });
      const totalGrams = input.allocations.reduce((sum, allocation) => sum.plus(allocation.grams), new Prisma.Decimal(0));
      const quantityKg = totalGrams.div(1000).toFixed(8);
      const saleInput = {
        customerId: "",
        transactionDate: input.transactionDate,
        quantityKg,
        purityBps: input.purityBps,
        pricePerGram: input.pricePerGram,
        topGrams: input.topGrams,
        downGrams: input.downGrams,
        discountAmount: "0",
        initialPayment: "0",
        cashAccountId: "",
        method: "OTHER" as const,
        note: input.note || "",
        allocations: input.allocations,
      };
      const sale = await postSale(user, saleInput, input.requestId);
      return Response.json(sale, { status: 201 });
    }
    const result = await recordCustomerAdvance(user.id, input);
    return Response.json(result, { status: input.action === "CREATE_ADVANCE" || input.action === "CREATE_REQUEST" ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
