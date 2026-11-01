import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.union([z.string().trim().min(6).max(40), z.literal("")]),
}).strict();

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const input = profileSchema.parse(await readJson(request));
    const phone = input.phone || null;

    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true, phone: true },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { name: input.name, phone },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "profile.updated",
        entity: "User",
        entityId: user.id,
        details: {
          before: { name: current.name, phone: current.phone },
          after: { name: input.name, phone },
        },
      });
    });

    return Response.json({ name: input.name, phone });
  } catch (error) {
    return apiError(error);
  }
}
