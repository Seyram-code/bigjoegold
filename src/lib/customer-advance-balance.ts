import { Prisma } from "@prisma/client";

type AdvancePayment = { amount: Prisma.Decimal; direction: "INBOUND" | "OUTBOUND" };
type AdvanceFulfillment = { amount: Prisma.Decimal };

export function calculateCustomerAdvanceBalance(
  openingBalance: Prisma.Decimal,
  payments: readonly AdvancePayment[],
  fulfillments: readonly AdvanceFulfillment[],
) {
  const paymentBalance = payments.reduce((balance, payment) => balance.plus(
    payment.direction === "INBOUND" ? payment.amount : payment.amount.negated(),
  ), new Prisma.Decimal(0));
  const fulfilledAmount = fulfillments.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
  return openingBalance.plus(paymentBalance).minus(fulfilledAmount);
}
