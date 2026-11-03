import { prisma } from "@/lib/prisma";
import { addAudit } from "@/lib/records";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { customerUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser("customers:read");
    const { id } = await params;
    const mayViewPersonal = can(user.role, "customers:personal:read", user.permissions);
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        kind: true,
        isActive: true,
        createdAt: true,
        ...(mayViewPersonal ? {
          phone: true,
          alternativePhone: true,
          email: true,
          dateOfBirth: true,
          gender: true,
          idType: true,
          idNumber: true,
          tin: true,
          address: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          region: true,
          country: true,
          gpsLocation: true,
          notes: true,
        } : {}),
      },
    });
    if (!customer) throw new HttpError("Customer not found", 404);
    return Response.json(customer);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser("customers:write");
    const { id } = await params;
    const input = customerUpdateSchema.parse(await readJson(request));
    const customer = await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({ where: { id } });
      if (!current) throw new HttpError("Customer not found", 404);
      const updated = await tx.customer.update({
        where: { id },
        data: {
          ...input,
          phone: input.phone === undefined ? undefined : input.phone || null,
          alternativePhone: input.alternativePhone === undefined ? undefined : input.alternativePhone || null,
          email: input.email === undefined ? undefined : input.email || null,
          dateOfBirth: input.dateOfBirth === undefined ? undefined : input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
          gender: input.gender === undefined ? undefined : input.gender || null,
          idType: input.idType === undefined ? undefined : input.idType || null,
          idNumber: input.idNumber === undefined ? undefined : input.idNumber || null,
          tin: input.tin === undefined ? undefined : input.tin || null,
          address: input.address === undefined ? undefined : input.address || null,
          addressLine1: input.addressLine1 === undefined ? undefined : input.addressLine1 || null,
          addressLine2: input.addressLine2 === undefined ? undefined : input.addressLine2 || null,
          city: input.city === undefined ? undefined : input.city || null,
          region: input.region === undefined ? undefined : input.region || null,
          country: input.country,
          gpsLocation: input.gpsLocation === undefined ? undefined : input.gpsLocation || null,
          notes: input.notes === undefined ? undefined : input.notes || null,
        },
      });
      const action = input.isActive === undefined ? "customer.updated" : input.isActive ? "customer.restored" : "customer.archived";
      await addAudit(tx, { userId: user.id, action, entity: "Customer", entityId: id });
      return updated;
    });
    return Response.json(customer);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const user = await requireUser("customers:write");
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id },
        select: {
          code: true,
          name: true,
          kind: true,
          _count: { select: { trades: true, payments: true, advances: true, buyerFinanceAccounts: true } },
        },
      });
      if (!customer) throw new HttpError("Customer not found", 404);
      const hasHistory = Object.values(customer._count).some((count) => count > 0);
      if (hasHistory) {
        throw new HttpError("This customer has transaction or financing history and cannot be deleted. Archive the customer to preserve their records.", 409);
      }
      await addAudit(tx, {
        userId: user.id,
        action: "customer.deleted",
        entity: "Customer",
        entityId: id,
        details: { code: customer.code, name: customer.name, kind: customer.kind },
      });
      await tx.customer.delete({ where: { id } });
    });
    return Response.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
