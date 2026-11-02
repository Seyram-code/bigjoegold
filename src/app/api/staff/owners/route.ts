import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { createOwnerCredentialUser } from "@/lib/staff";
import { ownerCreateSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const actor = await requireUser("staff:write");
    if (actor.role !== "OWNER") throw new HttpError("Only an owner can create another owner account", 403);
    const input = ownerCreateSchema.parse(await readJson(request));
    const owner = await prisma.$transaction(async (tx) => {
      const created = await createOwnerCredentialUser(tx, {
        name: input.name,
        email: input.email,
        phone: input.phone,
        password: input.password,
      });
      await addAudit(tx, {
        userId: actor.id,
        action: "owner.created",
        entity: "User",
        entityId: created.id,
        details: { before: null, after: { role: created.role, isActive: created.isActive } },
      });
      return created;
    });

    return Response.json({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      role: owner.role,
      isActive: owner.isActive,
      createdAt: owner.createdAt,
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
