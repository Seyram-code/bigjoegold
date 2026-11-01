import { requireUser } from "@/lib/authz";
import { recordPaymentMovement } from "@/lib/finance";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const reconcileSchema = z.object({
  paymentId: z.string().trim().min(1).max(191),
  cashAccountId: z.string().trim().min(1).max(191),
}).strict();

export async function GET() {
  try {
    await requireUser("payments:read");
    const payments = await prisma.payment.findMany({
      where: { cashMovement: null },
      orderBy: { paidAt: "desc" },
      take: 300,
      include: {
        trade: { select: { reference: true, type: true } },
        cashAccount: { select: { id: true, name: true } },
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
    const user = await requireUser("finance:manage");
    const input = reconcileSchema.parse(await readJson(request));
    const payment = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Payment WHERE id = ${input.paymentId} FOR UPDATE`;
      const current = await tx.payment.findUnique({ where: { id: input.paymentId } });
      if (!current) throw new HttpError("Payment not found", 404);
      const existing = await tx.cashMovement.findUnique({ where: { paymentId: current.id } });
      if (existing) throw new HttpError("This payment is already reconciled to the cash ledger", 409);
      await tx.payment.update({ where: { id: current.id }, data: { cashAccountId: input.cashAccountId } });
      await recordPaymentMovement(tx, {
        paymentId: current.id,
        cashAccountId: input.cashAccountId,
        direction: current.direction,
        amount: current.amount,
        movementDate: current.paidAt,
        description: current.note || `Reconciled payment ${current.reference}`,
        createdById: user.id,
      });
      await addAudit(tx, {
        userId: user.id,
        action: "finance.payment.reconciled",
        entity: "Payment",
        entityId: current.id,
        details: { reference: current.reference, accountId: input.cashAccountId, amount: current.amount.toString() },
      });
      return tx.payment.findUniqueOrThrow({
        where: { id: current.id },
        include: { cashAccount: { select: { id: true, name: true } } },
      });
    });
    return Response.json(payment);
  } catch (error) {
    return apiError(error);
  }
}
