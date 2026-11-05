import { requireUser, userCan } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { saveReceiving } from "@/lib/receiving";
import { receivingSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser("purchases:write");
    await enforceUserRateLimit(user.id, "purchase-write", { limit: 20 });
    const { id } = await context.params;
    const input = receivingSchema.parse(await readJson(request));
    if (input.financingAccountId && !userCan(user, "payments:write")) {
      throw new Response("You do not have permission to apply buyer financing", { status: 403 });
    }
    const trade = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Trade WHERE id = ${id} FOR UPDATE`;
      if (locked.length === 0) throw new HttpError("Purchase draft not found", 404);
      const draft = await tx.trade.findUnique({ where: { id } });
      if (!draft || draft.type !== "PURCHASE" || draft.status !== "DRAFT") {
        throw new HttpError("Only an open purchase draft can be changed or completed", 409);
      }
      return saveReceiving(tx, user.id, input, draft);
    }, { maxWait: 10_000, timeout: 30_000 });
    return Response.json(trade);
  } catch (error) {
    return apiError(error);
  }
}
