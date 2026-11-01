import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addAudit, reference } from "@/lib/records";
import { HttpError } from "@/lib/http";
import { recordPaymentMovement } from "@/lib/finance";
import type { CustomerAdvanceInput } from "@/lib/validation";

type TransactionClient = Prisma.TransactionClient;

async function currentReferencePrice(tx: TransactionClient) {
  return tx.goldBoardPrice.findFirst({
    where: { priceType: "SELLING", currency: "GHS", priceUnit: "GHS_PER_GRAM_PURE_GOLD", effectiveAt: { lte: new Date() } },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

async function advanceBalance(tx: TransactionClient, advanceId: string) {
  const [payments, fulfillments] = await Promise.all([
    tx.payment.findMany({ where: { customerAdvanceId: advanceId }, select: { amount: true, direction: true } }),
    tx.advanceFulfillment.findMany({ where: { request: { advanceId } }, select: { amount: true } }),
  ]);
  const depositsAndRefunds = payments.reduce((balance, payment) => balance.plus(
    payment.direction === "INBOUND" ? payment.amount : payment.amount.negated(),
  ), new Prisma.Decimal(0));
  return depositsAndRefunds.minus(fulfillments.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
}

async function ensureAdvanceLocked(tx: TransactionClient, advanceId: string) {
  await tx.$queryRaw`SELECT id FROM CustomerAdvance WHERE id = ${advanceId} FOR UPDATE`;
  const advance = await tx.customerAdvance.findUnique({ where: { id: advanceId }, include: { customer: true } });
  if (!advance) throw new HttpError("Customer advance not found", 404);
  return advance;
}

export async function recordCustomerAdvance(userId: string, input: Exclude<CustomerAdvanceInput, { action: "FULFILL" }>) {
  return prisma.$transaction(async (tx) => {
    const paidAt = "paidAt" in input ? new Date(input.paidAt) : new Date();
    if (paidAt > new Date()) throw new HttpError("Advance payment date cannot be in the future", 400);

    if (input.action === "CREATE_ADVANCE") {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer || !customer.isActive || customer.kind !== "BUYER") throw new HttpError("Select an active buyer", 400);
      const referencePrice = await currentReferencePrice(tx);
      const advance = await tx.customerAdvance.create({
        data: {
          reference: reference("ADV"),
          customerId: customer.id,
          note: input.note || null,
          createdById: userId,
        },
      });
      const payment = await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: "INBOUND",
          amount: input.amount,
          referencePricePerGram: referencePrice?.priceAmount ?? null,
          referencePriceSource: referencePrice?.source ?? null,
          referencePriceEffectiveAt: referencePrice?.effectiveAt ?? null,
          method: input.method,
          note: input.note || null,
          paidAt,
          customerId: customer.id,
          customerAdvanceId: advance.id,
          cashAccountId: input.cashAccountId,
          createdById: userId,
        },
      });
      await recordPaymentMovement(tx, {
        paymentId: payment.id,
        cashAccountId: payment.cashAccountId,
        direction: payment.direction,
        amount: payment.amount,
        movementDate: payment.paidAt,
        description: `Customer gold advance ${advance.reference}`,
        createdById: userId,
      });
      await addAudit(tx, {
        userId,
        action: "customer.advance.created",
        entity: "CustomerAdvance",
        entityId: advance.id,
        details: { reference: advance.reference, customerId: customer.id, amount: payment.amount.toString() },
      });
      return { ...advance, paymentId: payment.id };
    }

    if (input.action === "ADD_FUNDS" || input.action === "REFUND") {
      const advance = await ensureAdvanceLocked(tx, input.advanceId);
      const referencePrice = input.action === "ADD_FUNDS" ? await currentReferencePrice(tx) : null;
      const amount = new Prisma.Decimal(input.amount);
      if (input.action === "REFUND") {
        const balance = await advanceBalance(tx, advance.id);
        if (balance.lessThan(amount)) throw new HttpError("Refund cannot exceed the customer’s available GHS credit", 409);
      }
      const payment = await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: input.action === "ADD_FUNDS" ? "INBOUND" : "OUTBOUND",
          amount,
          referencePricePerGram: referencePrice?.priceAmount ?? null,
          referencePriceSource: referencePrice?.source ?? null,
          referencePriceEffectiveAt: referencePrice?.effectiveAt ?? null,
          method: input.method,
          note: input.note || null,
          paidAt,
          customerId: advance.customerId,
          customerAdvanceId: advance.id,
          cashAccountId: input.cashAccountId,
          createdById: userId,
        },
      });
      await recordPaymentMovement(tx, {
        paymentId: payment.id,
        cashAccountId: payment.cashAccountId,
        direction: payment.direction,
        amount: payment.amount,
        movementDate: payment.paidAt,
        description: `${input.action === "ADD_FUNDS" ? "Additional funds for" : "Refund for"} customer gold advance ${advance.reference}`,
        createdById: userId,
      });
      await addAudit(tx, {
        userId,
        action: input.action === "ADD_FUNDS" ? "customer.advance.funded" : "customer.advance.refunded",
        entity: "CustomerAdvance",
        entityId: advance.id,
        details: { reference: advance.reference, paymentReference: payment.reference, amount: payment.amount.toString() },
      });
      return payment;
    }

    const advance = await ensureAdvanceLocked(tx, input.advanceId);
    const request = await tx.customerAdvanceRequest.create({
      data: {
        reference: reference("ARQ"),
        advanceId: advance.id,
        requestedGrams: input.requestedGrams,
        note: input.note || null,
        createdById: userId,
      },
    });
    await addAudit(tx, {
      userId,
      action: "customer.advance.gold_requested",
      entity: "CustomerAdvanceRequest",
      entityId: request.id,
      details: { reference: request.reference, advanceReference: advance.reference, requestedGrams: request.requestedGrams.toString() },
    });
    return request;
  });
}

export async function getCustomerAdvanceBalance(tx: TransactionClient, advanceId: string) {
  return advanceBalance(tx, advanceId);
}
