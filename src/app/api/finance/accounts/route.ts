import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { calculateCashBalances } from "@/lib/finance";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { financeAccountSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireUser("payments:read");
    const url = new URL(request.url);
    if (url.searchParams.get("options") === "true") {
      const accounts = await prisma.cashAccount.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: { id: true, name: true, type: true, currency: true, isActive: true },
      });
      return Response.json(accounts);
    }
    const [accounts, movementTotals] = await Promise.all([
      prisma.cashAccount.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
      prisma.cashMovement.groupBy({
        by: ["accountId", "direction"],
        where: { approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] } },
        _sum: { amount: true },
      }),
    ]);
    const balances = calculateCashBalances(movementTotals.map((movement) => ({
      accountId: movement.accountId,
      direction: movement.direction,
      amount: movement._sum.amount ?? new Prisma.Decimal(0),
      approvalStatus: "APPROVED",
    })));
    return Response.json(accounts.map((account) => ({
      ...account,
      balance: (balances.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
    })));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("finance:manage");
    const input = financeAccountSchema.parse(await readJson(request));
    const account = await prisma.$transaction(async (tx) => {
      const openingBalance = new Prisma.Decimal(input.openingBalance);
      if (!openingBalance.isFinite() || openingBalance.isNegative()) throw new HttpError("Opening balance cannot be negative", 400);
      const created = await tx.cashAccount.create({
        data: {
          name: input.name,
          type: input.type,
          currency: input.currency,
          institution: input.institution || null,
          accountReference: input.accountReference || null,
          createdById: user.id,
        },
      });
      if (openingBalance.greaterThan(0)) {
        await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: created.id,
            type: "OPENING_BALANCE",
            direction: "INBOUND",
            amount: openingBalance,
            movementDate: new Date(input.openingDate),
            description: "Opening account balance",
            createdById: user.id,
          },
        });
      }
      await addAudit(tx, {
        userId: user.id,
        action: "finance.account.created",
        entity: "CashAccount",
        entityId: created.id,
        details: { name: created.name, type: created.type, currency: created.currency, openingBalance: openingBalance.toString() },
      });
      return created;
    });
    return Response.json({ ...account, balance: input.openingBalance }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
