import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { clearLoginFailures } from "@/lib/login-lockout";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };
const passwordSchema = z.object({
  password: z.string().min(12).max(128),
}).strict();

export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireUser("staff:write");
    if (actor.role !== "OWNER") throw new HttpError("Only an owner can reset an owner password", 403);
    const { id } = await params;
    if (id === actor.id) throw new HttpError("Ask another active owner to reset your password", 400);
    const { password } = passwordSchema.parse(await readJson(request));
    const passwordHash = await hashPassword(password);

    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { id: true, name: true, role: true } });
      if (!target || target.role !== "OWNER") throw new HttpError("Owner account not found", 404);
      const result = await tx.account.updateMany({
        where: { userId: id, providerId: "credential" },
        data: { password: passwordHash },
      });
      if (result.count !== 1) throw new Error(`Owner ${id} does not have exactly one credential account`);
      await tx.session.deleteMany({ where: { userId: id } });
      await addAudit(tx, {
        userId: actor.id,
        action: "owner.password.reset",
        entity: "User",
        entityId: id,
        details: { before: null, after: { passwordReset: true, resetBy: actor.name } },
      });
    });

    await clearLoginFailures(`user:${id}`);
    return Response.json({ message: "Owner password reset. They can now sign in with the new password." });
  } catch (error) {
    return apiError(error);
  }
}
