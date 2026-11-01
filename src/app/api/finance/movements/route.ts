import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { calculateCashBalances } from "@/lib/finance";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { financeMovementSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireUser("payments:read");
    const movements = await prisma.cashMovement.findMany({
      orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        account: { select: { id: true, name: true, type: true, currency: true } },
        payment: {
          select: {
            reference: true,
            direction: true,
            trade: { select: { reference: true, type: true } },
          },
        },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    return Response.json(movements);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("finance:manage");
    const input = financeMovementSchema.parse(await readJson(request));
    const created = await prisma.$transaction(async (tx) => {
      if (input.action === "TRANSFER") {
        if (input.fromAccountId === input.toAccountId) throw new HttpError("Choose two different accounts", 400);
        await tx.$queryRaw`SELECT id FROM CashAccount WHERE id IN (${Prisma.join([input.fromAccountId, input.toAccountId].sort())}) ORDER BY id FOR UPDATE`;
        const accounts = await tx.cashAccount.findMany({
          where: { id: { in: [input.fromAccountId, input.toAccountId] }, isActive: true },
        });
        const source = accounts.find((account) => account.id === input.fromAccountId);
        const destination = accounts.find((account) => account.id === input.toAccountId);
        if (!source || !destination) throw new HttpError("Both accounts must be active", 400);
        if (source.currency !== destination.currency) throw new HttpError("Transfers require accounts with the same currency", 400);
        const movements = await tx.cashMovement.findMany({
          where: {
            accountId: { in: [source.id, destination.id] },
            approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
          },
          select: { accountId: true, direction: true, amount: true, approvalStatus: true },
        });
        const balance = calculateCashBalances(movements).get(source.id) ?? new Prisma.Decimal(0);
        const amount = new Prisma.Decimal(input.amount);
        if (amount.greaterThan(balance)) throw new HttpError("Transfer exceeds the available account balance", 409);
        const group = reference("TRF");
        const sourceMovement = await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: source.id,
            type: "TRANSFER_OUT",
            direction: "OUTBOUND",
            amount,
            movementDate: new Date(input.movementDate),
            description: input.description,
            transferGroupId: group,
            createdById: user.id,
          },
        });
        const destinationMovement = await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: destination.id,
            type: "TRANSFER_IN",
            direction: "INBOUND",
            amount,
            movementDate: new Date(input.movementDate),
            description: input.description,
            transferGroupId: group,
            createdById: user.id,
          },
        });
        await addAudit(tx, {
          userId: user.id,
          action: "finance.account.transferred",
          entity: "CashMovement",
          entityId: sourceMovement.id,
          details: { group, from: source.name, to: destination.name, amount: amount.toString() },
        });
        return [sourceMovement, destinationMovement];
      }

      await tx.$queryRaw`SELECT id FROM CashAccount WHERE id = ${input.accountId} FOR UPDATE`;
      const account = await tx.cashAccount.findUnique({ where: { id: input.accountId } });
      if (!account || !account.isActive) throw new HttpError("Select an active account", 400);
      const amount = new Prisma.Decimal(input.amount);
      const settings = await tx.financeConfig.findUnique({ where: { id: "default" } });
      const threshold = settings?.adjustmentApprovalThreshold;
      const requiresApproval = Boolean(threshold && amount.greaterThanOrEqualTo(threshold));
      const movement = await tx.cashMovement.create({
        data: {
          reference: reference("FIN"),
          accountId: account.id,
          type: input.direction === "INBOUND" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          direction: input.direction,
          amount,
          movementDate: new Date(input.movementDate),
          description: input.description,
          approvalStatus: requiresApproval ? "PENDING" : "NOT_REQUIRED",
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: requiresApproval ? "finance.adjustment.submitted_for_approval" : "finance.adjustment.recorded",
        entity: "CashMovement",
        entityId: movement.id,
        details: { reference: movement.reference, account: account.name, amount: amount.toString(), direction: input.direction, approvalStatus: movement.approvalStatus },
      });
      return [movement];
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
