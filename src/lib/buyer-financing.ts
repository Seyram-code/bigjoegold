import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addAudit, reference } from "@/lib/records";
import { HttpError } from "@/lib/http";
import { recordPaymentMovement } from "@/lib/finance";
import type { BuyerFinanceInput } from "@/lib/validation";

type TransactionClient = Prisma.TransactionClient;

export function calculateBuyerFinanceBalance(
  payments: Array<{ amount: Prisma.Decimal | string | number; direction: "INBOUND" | "OUTBOUND" }>,
  settlements: Array<{ amount: Prisma.Decimal | string | number }>,
) {
  const payoutsAndReceipts = payments.reduce((balance, payment) => {
    const amount = new Prisma.Decimal(payment.amount);
    return balance.plus(payment.direction === "OUTBOUND" ? amount : amount.negated());
  }, new Prisma.Decimal(0));
  return payoutsAndReceipts.minus(settlements.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
}

async function currentReferencePrice(tx: TransactionClient) {
  return tx.goldBoardPrice.findFirst({
    where: { priceType: "RECEIVING", currency: "GHS", priceUnit: "GHS_PER_GRAM_PURE_GOLD", effectiveAt: { lte: new Date() } },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getBuyerFinanceBalance(tx: TransactionClient, accountId: string) {
  const [payments, settlements] = await Promise.all([
    tx.payment.findMany({ where: { buyerFinanceAccountId: accountId }, select: { amount: true, direction: true } }),
    tx.buyerFinanceSettlement.findMany({ where: { accountId }, select: { amount: true } }),
  ]);
  return calculateBuyerFinanceBalance(payments, settlements);
}

async function lockedAccount(tx: TransactionClient, accountId: string) {
  await tx.$queryRaw`SELECT id FROM BuyerFinanceAccount WHERE id = ${accountId} FOR UPDATE`;
  const account = await tx.buyerFinanceAccount.findUnique({ where: { id: accountId }, include: { customer: true } });
  if (!account) throw new HttpError("Buyer financing account not found", 404);
  if (!account.customer.isActive || account.customer.kind !== "BUYER") {
    throw new HttpError("Buyer financing requires an active buyer profile", 409);
  }
  return account;
}

export async function recordBuyerFinanceAdvance(userId: string, input: BuyerFinanceInput) {
  return prisma.$transaction(async (tx) => {
    const paidAt = new Date(input.paidAt);
    if (paidAt > new Date()) throw new HttpError("Advance payment date cannot be in the future", 400);

    const account = input.action === "CREATE_ADVANCE"
      ? await (async () => {
        const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (!customer || !customer.isActive || customer.kind !== "BUYER") {
          throw new HttpError("Select an active buyer", 400);
        }
        return tx.buyerFinanceAccount.create({
          data: {
            reference: reference("BFA"),
            customerId: customer.id,
            note: input.note || null,
            createdById: userId,
          },
          include: { customer: true },
        });
      })()
      : await lockedAccount(tx, input.accountId);

    const referencePrice = await currentReferencePrice(tx);
    const payment = await tx.payment.create({
      data: {
        reference: reference("PAY"),
        direction: "OUTBOUND",
        amount: new Prisma.Decimal(input.amount),
        referencePricePerGram: referencePrice?.priceAmount ?? null,
        referencePriceSource: referencePrice?.source ?? null,
        referencePriceEffectiveAt: referencePrice?.effectiveAt ?? null,
        method: input.method,
        note: input.note || null,
        paidAt,
        customerId: account.customerId,
        buyerFinanceAccountId: account.id,
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
      description: `Buyer gold financing advance ${account.reference}`,
      createdById: userId,
    });
    await addAudit(tx, {
      userId,
      action: input.action === "CREATE_ADVANCE" ? "buyer.finance.created" : "buyer.finance.advanced",
      entity: "BuyerFinanceAccount",
      entityId: account.id,
      details: {
        reference: account.reference,
        customerId: account.customerId,
        paymentReference: payment.reference,
        amount: payment.amount.toString(),
      },
    });
    return { accountId: account.id, paymentId: payment.id };
  });
}
