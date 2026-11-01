import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const accountStateSchema = z.object({ isActive: z.boolean() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("finance:manage");
    const { id } = await context.params;
    const input = accountStateSchema.parse(await readJson(request));
    const account = await prisma.$transaction(async (tx) => {
      const updated = await tx.cashAccount.update({ where: { id }, data: { isActive: input.isActive } });
      await addAudit(tx, {
        userId: user.id,
        action: input.isActive ? "finance.account.activated" : "finance.account.deactivated",
        entity: "CashAccount",
        entityId: id,
        details: { name: updated.name },
      });
      return updated;
    });
    return Response.json(account);
  } catch (error) {
    return apiError(error);
  }
}
