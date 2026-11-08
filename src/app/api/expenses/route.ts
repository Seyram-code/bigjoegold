import { PaymentDirection, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { expenseSchema } from "@/lib/validation";

function parseDateRange(url: URL) {
  const now = new Date();
  const from = url.searchParams.get("from") ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError("Select a valid expense date range", 400);
  }
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toStart = new Date(`${to}T00:00:00.000Z`);
  if (
    Number.isNaN(fromDate.getTime())
    || Number.isNaN(toStart.getTime())
    || fromDate.toISOString().slice(0, 10) !== from
    || toStart.toISOString().slice(0, 10) !== to
    || fromDate > toStart
  ) {
    throw new HttpError("Expense start date must be on or before its end date", 400);
  }
  return {
    fromDate,
    toDate: new Date(toStart.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

export async function GET(request: Request) {
  try {
    await requireUser("payments:read");
    const { fromDate, toDate } = parseDateRange(new URL(request.url));
    const [accounts, expenses] = await Promise.all([
      prisma.cashAccount.findMany({
        where: { isActive: true, currency: "GHS" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      }),
      prisma.cashMovement.findMany({
        where: {
          type: "EXPENSE",
          movementDate: { gte: fromDate, lte: toDate },
        },
        orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
        include: {
          account: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
    ]);
    return Response.json({ accounts, expenses });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("finance:manage");
    const input = expenseSchema.parse(await readJson(request));
    const amount = new Prisma.Decimal(input.amount);
    const movementDate = new Date(input.movementDate);
    const expense = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM CashAccount WHERE id = ${input.accountId} FOR UPDATE`;
      const account = await tx.cashAccount.findUnique({ where: { id: input.accountId } });
      if (!account || !account.isActive) throw new HttpError("Select an active cash or bank account", 400);
      if (account.currency !== "GHS") throw new HttpError("Expenses must be recorded in a GHS account", 400);

      const settings = await tx.financeConfig.findUnique({ where: { id: "default" } });
      const requiresApproval = Boolean(settings?.adjustmentApprovalThreshold
        && amount.greaterThanOrEqualTo(settings.adjustmentApprovalThreshold));

      const created = await tx.cashMovement.create({
        data: {
          reference: reference("EXP"),
          accountId: account.id,
          type: "EXPENSE",
          expenseCategory: input.category,
          direction: PaymentDirection.OUTBOUND,
          amount,
          movementDate,
          description: input.description,
          approvalStatus: requiresApproval ? "PENDING" : "NOT_REQUIRED",
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: requiresApproval ? "finance.expense.submitted_for_approval" : "finance.expense.recorded",
        entity: "CashMovement",
        entityId: created.id,
        details: {
          reference: created.reference,
          account: account.name,
          category: created.expenseCategory,
          amount: created.amount.toString(),
          approvalStatus: created.approvalStatus,
        },
      });
      return created;
    });

    return Response.json(expense, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
