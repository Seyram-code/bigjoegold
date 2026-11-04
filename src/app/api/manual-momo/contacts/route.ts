import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { formatManualMomoContactPhone, normalizeManualMomoPhone } from "@/lib/manual-momo-contacts";
import { prisma } from "@/lib/prisma";
import { manualMomoContactSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireUser("payments:read");
    const contacts = await prisma.manualMomoContact.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, phone: true, email: true, notes: true, createdAt: true, updatedAt: true },
    });
    return Response.json(contacts);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const input = manualMomoContactSchema.parse(await readJson(request));
    const phone = input.phone ? formatManualMomoContactPhone(input.phone) : null;
    const phoneNormalized = normalizeManualMomoPhone(phone);
    if (phoneNormalized && await prisma.manualMomoContact.findUnique({ where: { phoneNormalized }, select: { id: true } })) {
      throw new HttpError("A Manual Bank & MOMO contact already uses this phone number", 409);
    }

    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.manualMomoContact.create({
        data: {
          name: input.name,
          phone,
          phoneNormalized,
          email: input.email || null,
          notes: input.notes || null,
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.contact.created",
        entity: "ManualMomoContact",
        entityId: created.id,
        details: { name: created.name, phone: created.phone },
      });
      return created;
    });

    return Response.json(contact, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A Manual Bank & MOMO contact already uses this phone number" }, { status: 409 });
    }
    return apiError(error);
  }
}
