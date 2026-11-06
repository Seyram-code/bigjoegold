import { Prisma, type PaymentDirection } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { reference } from "@/lib/records";

type TransactionClient = Prisma.TransactionClient;

export async function recordPaymentMovement(
  tx: TransactionClient,
  input: {
    paymentId: string;
    cashAccountId?: string | null;
    direction: PaymentDirection;
    amount: Prisma.Decimal | string | number;
    movementDate: Date;
    description?: string | null;
    createdById: string;
  },
) {
  if (!input.cashAccountId) return null;
  const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
  if (!account || !account.isActive) throw new HttpError("Select an active cash or bank account", 400);
  if (account.currency !== "GHS") throw new HttpError("Gold trading payments must use a GHS account", 400);
  return tx.cashMovement.create({
    data: {
      reference: reference("FIN"),
      accountId: account.id,
      type: "PAYMENT",
      direction: input.direction,
      amount: input.amount,
      movementDate: input.movementDate,
      description: input.description || null,
      paymentId: input.paymentId,
      createdById: input.createdById,
    },
  });
}

export function calculateCashBalances(
  movements: Array<{ accountId: string; direction: PaymentDirection; amount: Prisma.Decimal; approvalStatus: string }>,
) {
  const balances = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    if (!["NOT_REQUIRED", "APPROVED"].includes(movement.approvalStatus)) continue;
    const amount = movement.direction === "INBOUND"
      ? movement.amount
      : movement.amount.negated();
    balances.set(movement.accountId, (balances.get(movement.accountId) ?? new Prisma.Decimal(0)).plus(amount));
  }
  return balances;
}

export function calculateRunningCashBalances(
  movements: Array<{
    id: string;
    accountId: string;
    direction: PaymentDirection;
    amount: Prisma.Decimal;
    approvalStatus: string;
    movementDate: Date;
    createdAt: Date;
  }>,
) {
  const balances = new Map<string, Prisma.Decimal>();
  const runningBalances = new Map<string, Prisma.Decimal>();
  const orderedMovements = [...movements].sort((a, b) =>
    a.movementDate.getTime() - b.movementDate.getTime()
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.id.localeCompare(b.id));

  for (const movement of orderedMovements) {
    const balance = balances.get(movement.accountId) ?? new Prisma.Decimal(0);
    if (["NOT_REQUIRED", "APPROVED"].includes(movement.approvalStatus)) {
      const amount = movement.direction === "INBOUND" ? movement.amount : movement.amount.negated();
      balances.set(movement.accountId, balance.plus(amount));
    }
    runningBalances.set(movement.id, balances.get(movement.accountId) ?? balance);
  }
  return runningBalances;
}
