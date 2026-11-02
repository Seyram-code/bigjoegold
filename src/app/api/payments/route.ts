import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { addAudit, reference } from "@/lib/records";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { paymentSchema } from "@/lib/validation";
import { recordPaymentMovement } from "@/lib/finance";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { paymentConfirmationSms, sendOwnerSms } from "@/lib/sms";
import { sendOwnerTransactionEmail } from "@/lib/email";

export async function GET() {
  try {
    await requireUser("payments:read");
    const payments = await prisma.payment.findMany({
      orderBy: { paidAt: "desc" },
      take: 250,
      include: {
        customer: { select: { name: true } },
        trade: { select: { reference: true, type: true } },
        cashAccount: { select: { id: true, name: true, type: true } },
        createdBy: { select: { name: true } },
      },
    });
    return Response.json(payments);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    await enforceUserRateLimit(user.id, "payment-write", { limit: 20 });
    const input = paymentSchema.parse(await readJson(request));
    if (!input.cashAccountId) throw new HttpError("Select the cash or bank account used for this payment", 400);
    const payment = await prisma.$transaction(async (tx) => {
      let customerId = input.customerId || null;
      if (input.tradeId) {
        await tx.$queryRaw`SELECT id FROM Trade WHERE id = ${input.tradeId} FOR UPDATE`;
        const trade = await tx.trade.findUnique({
          where: { id: input.tradeId },
          include: { corrections: { select: { creditAmount: true, refundAmount: true } } },
        });
        if (!trade || trade.status !== "POSTED") throw new HttpError("Trade not found or not open", 404);
        if (input.customerId && input.customerId !== trade.customerId) {
          throw new HttpError("The selected customer does not belong to this trade", 400);
        }
        const expected = trade.type === "SALE" ? "INBOUND" : "OUTBOUND";
        if (input.direction !== expected) throw new HttpError(`Payments for this ${trade.type.toLowerCase()} must be ${expected.toLowerCase()}`, 400);
        const alreadyPaid = await tx.payment.aggregate({
          where: { tradeId: trade.id, direction: expected },
          _sum: { amount: true },
        });
        const credits = trade.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), new Prisma.Decimal(0));
        const refunds = trade.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), new Prisma.Decimal(0));
        const balance = new Prisma.Decimal(trade.totalAmount)
          .minus(credits)
          .minus(alreadyPaid._sum.amount ?? 0)
          .plus(trade.type === "SALE" ? refunds : 0);
        if (new Prisma.Decimal(String(input.amount)).greaterThan(balance)) throw new HttpError("Payment exceeds the outstanding trade balance", 400);
        customerId = trade.customerId;
      } else {
        throw new HttpError("Select the trade this payment belongs to", 400);
      }
      const created = await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: input.direction,
          amount: input.amount,
          method: input.method,
          cashAccountId: input.cashAccountId,
          note: input.note || null,
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          tradeId: input.tradeId || null,
          customerId,
          createdById: user.id,
        },
      });
      await recordPaymentMovement(tx, {
        paymentId: created.id,
        cashAccountId: input.cashAccountId,
        direction: created.direction,
        amount: created.amount,
        movementDate: created.paidAt,
        description: input.note || `Payment ${created.reference}`,
        createdById: user.id,
      });
      await addAudit(tx, { userId: user.id, action: "payment.recorded", entity: "Payment", entityId: created.id, details: { reference: created.reference, amount: input.amount, direction: input.direction } });
      return created;
    });
    const paymentDetails = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: {
        customer: { select: { name: true } },
        trade: { select: { reference: true } },
      },
    });
    after(async () => {
      await sendOwnerTransactionEmail({
        type: "PAYMENT",
        reference: paymentDetails.reference,
        direction: paymentDetails.direction,
        amount: paymentDetails.amount.toString(),
        method: paymentDetails.method,
        customerName: paymentDetails.customer?.name,
        tradeReference: paymentDetails.trade?.reference,
        recordedBy: user.name,
      });
    });
    await sendOwnerSms(paymentConfirmationSms({
      reference: paymentDetails.reference,
      direction: paymentDetails.direction,
      amount: paymentDetails.amount.toString(),
      method: paymentDetails.method,
      customerName: paymentDetails.customer?.name,
      tradeReference: paymentDetails.trade?.reference,
      recordedBy: user.name,
    }));
    return Response.json(payment, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
