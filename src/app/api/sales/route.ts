import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { postSale } from "@/lib/sales";
import { saleSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { saleConfirmationSms, sendOwnerPaymentSms, sendOwnerSms } from "@/lib/sms";
import { sendOwnerTransactionEmail } from "@/lib/email";

export async function GET(request: Request) {
  try {
    await requireUser("trades:read");
    const search = new URL(request.url).searchParams;
    const query = search.get("q")?.trim() ?? "";
    const status = search.get("status") ?? "ALL";
    const fromValue = search.get("from");
    const toValue = search.get("to");
    const page = Number(search.get("page") ?? 1);
    const pageSize = Number(search.get("pageSize") ?? 250);
    if (!["ALL", "POSTED", "PARTIALLY_RETURNED", "RETURNED", "VOIDED"].includes(status)) throw new HttpError("Invalid sale status filter", 400);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new HttpError("Invalid sales pagination", 400);
    const from = fromValue ? new Date(fromValue) : null;
    const to = toValue ? new Date(toValue) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) {
      throw new HttpError("Provide a valid sale date range", 400);
    }
    const where: Prisma.TradeWhereInput = {
      type: "SALE" as const,
      ...(status === "ALL" ? { status: { in: ["POSTED", "RETURNED", "VOIDED"] } }
        : status === "PARTIALLY_RETURNED" ? { status: "POSTED" as const, corrections: { some: {} } }
          : status === "POSTED" ? { status: "POSTED" as const, corrections: { none: {} } }
            : { status: status as "RETURNED" | "VOIDED" }),
      ...(from || to ? { transactionDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query ? {
        OR: [
          { reference: { contains: query } },
          { customer: { name: { contains: query } } },
          { customer: { code: { contains: query } } },
        ],
      } : {}),
    };
    const [sales, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true } },
          allocations: { include: { lot: { select: { batchNumber: true, trade: { select: { reference: true } } } } } },
          payments: { select: { id: true, reference: true, amount: true, direction: true, method: true, paidAt: true } },
          advanceFulfillment: { select: { amount: true } },
          corrections: {
            include: {
              allocations: true,
              createdBy: { select: { name: true } },
              payments: { select: { id: true, reference: true, amount: true, direction: true, method: true, paidAt: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      prisma.trade.count({ where }),
    ]);
    const data = sales.map((sale) => {
      const returnedGrams = sale.corrections.reduce((sum, correction) => sum.plus(correction.quantityGrams), new Prisma.Decimal(0));
      const creditAmount = sale.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), new Prisma.Decimal(0));
      const refundedAmount = sale.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), new Prisma.Decimal(0));
      const paid = sale.payments.filter((payment) => payment.direction === "INBOUND").reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))
        .plus(sale.advanceFulfillment?.amount ?? 0);
      return {
        ...sale,
        returnedGrams: returnedGrams.toString(),
        creditAmount: creditAmount.toFixed(2),
        refundedAmount: refundedAmount.toFixed(2),
        outstandingBalance: Prisma.Decimal.max(
          new Prisma.Decimal(sale.totalAmount).minus(creditAmount).minus(paid).plus(refundedAmount),
          0,
        ).toFixed(2),
        saleStatus: sale.status === "VOIDED" ? "VOIDED" : sale.status === "RETURNED" ? "RETURNED" : returnedGrams.greaterThan(0) ? "PARTIALLY_RETURNED" : "POSTED",
      };
    });
    return Response.json({ sales: data, total, page, pageSize });
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && error instanceof Error && !(error instanceof HttpError)) {
      console.error("Sales POST failed", error);
      return Response.json({ error: `Sale could not be completed: ${error.message}` }, { status: 500 });
    }
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("sales:write");
    await enforceUserRateLimit(user.id, "sale-post", { limit: 20 });
    const input = saleSchema.parse(await readJson(request));
    const sale = await postSale(user, input);
    after(async () => {
      for (const payment of sale.payments) {
        await sendOwnerPaymentSms(payment.id, user.name);
      }
      await sendOwnerSms(saleConfirmationSms({
        reference: sale.reference,
        customerName: sale.customer?.name,
        quantityKg: sale.quantityKg.toString(),
        totalAmount: sale.totalAmount.toString(),
        amountPaid: sale.paymentAmount.toString(),
        recordedBy: user.name,
      }));
      await sendOwnerTransactionEmail({
        type: "SALE",
        reference: sale.reference,
        customerName: sale.customer?.name,
        quantityKg: sale.quantityKg.toString(),
        totalAmount: sale.totalAmount.toString(),
        amountPaid: sale.paymentAmount.toString(),
        recordedBy: user.name,
      });
    });
    return Response.json(sale, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
