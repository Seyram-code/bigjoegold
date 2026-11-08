import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { calculateCashBalances } from "@/lib/finance";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const approvalSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("finance:approve");
    const { id } = await context.params;
    const { decision } = approvalSchema.parse(await readJson(request));
    const movement = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM CashMovement WHERE id = ${id} FOR UPDATE`;
      const current = await tx.cashMovement.findUnique({ where: { id } });
      if (!current || current.approvalStatus !== "PENDING") throw new HttpError("Adjustment is not awaiting approval", 409);
      await tx.$queryRaw`SELECT id FROM CashAccount WHERE id = ${current.accountId} FOR UPDATE`;
      if (decision === "APPROVE" && current.direction === "OUTBOUND") {
        const rows = await tx.cashMovement.findMany({
          where: {
            accountId: current.accountId,
            approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
          },
          select: { accountId: true, direction: true, amount: true, approvalStatus: true },
        });
        const balance = calculateCashBalances(rows).get(current.accountId) ?? new Prisma.Decimal(0);
        if (current.amount.greaterThan(balance)) throw new HttpError("Approval would make the account balance negative", 409);
      }
      const updated = await tx.cashMovement.update({
        where: { id },
        data: {
          approvalStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approvedAt: new Date(),
          approvedById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: current.type === "EXPENSE"
          ? decision === "APPROVE" ? "finance.expense.approved" : "finance.expense.rejected"
          : decision === "APPROVE" ? "finance.adjustment.approved" : "finance.adjustment.rejected",
        entity: "CashMovement",
        entityId: id,
        details: {
          reference: current.reference,
          amount: current.amount.toString(),
          before: { approvalStatus: current.approvalStatus, approvedById: current.approvedById, approvedAt: current.approvedAt?.toISOString() ?? null },
          after: { approvalStatus: updated.approvalStatus, approvedById: updated.approvedById, approvedAt: updated.approvedAt?.toISOString() ?? null },
        },
      });
      return updated;
    });
    return Response.json(movement);
  } catch (error) {
    return apiError(error);
  }
}
