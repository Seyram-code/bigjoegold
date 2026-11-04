import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { formatManualMomoContactPhone, normalizeManualMomoPhone } from "@/lib/manual-momo-contacts";
import { prisma } from "@/lib/prisma";
import { manualMomoContactSchema } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("payments:write");
    const { id } = await params;
    const input = manualMomoContactSchema.parse(await readJson(request));
    const existing = await prisma.manualMomoContact.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError("Manual Bank & MOMO contact not found", 404);
    const phone = input.phone ? formatManualMomoContactPhone(input.phone) : null;
    const phoneNormalized = normalizeManualMomoPhone(phone);
    if (phoneNormalized && await prisma.manualMomoContact.findFirst({ where: { phoneNormalized, id: { not: id } }, select: { id: true } })) {
      throw new HttpError("A Manual Bank & MOMO contact already uses this phone number", 409);
    }

    const contact = await prisma.$transaction(async (tx) => {
      const updated = await tx.manualMomoContact.update({
        where: { id },
        data: { name: input.name, phone, phoneNormalized, email: input.email || null, notes: input.notes || null },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.contact.updated",
        entity: "ManualMomoContact",
        entityId: updated.id,
        details: { name: updated.name, phone: updated.phone },
      });
      return updated;
    });
    return Response.json(contact);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A Manual Bank & MOMO contact already uses this phone number" }, { status: 409 });
    }
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("payments:write");
    const { id } = await params;
    const contact = await prisma.manualMomoContact.findUnique({ where: { id } });
    if (!contact) throw new HttpError("Manual Bank & MOMO contact not found", 404);
    await prisma.$transaction(async (tx) => {
      await tx.manualMomoContact.delete({ where: { id } });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.contact.deleted",
        entity: "ManualMomoContact",
        entityId: id,
        details: { name: contact.name, phone: contact.phone },
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
