import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { addAudit } from "@/lib/records";
import { createCredentialUser } from "@/lib/staff";
import { staffSchema } from "@/lib/validation";
import { effectivePermissions, isPermission, isStaffRole, type Permission } from "@/lib/permissions";

export async function GET() {
  try {
    await requireUser("staff:read");
    const staff = await prisma.user.findMany({
      select: {
        id: true, name: true, phone: true, role: true, permissionOverrideSet: true, isActive: true, createdAt: true,
        roleRecord: { select: { permissions: { select: { permissionCode: true } } } },
        permissionGrants: { select: { permissionCode: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(staff.map((member) => {
      if (!isStaffRole(member.role)) throw new Error(`Staff member ${member.id} has an unknown role`);
      return {
        id: member.id,
        name: member.name,
        phone: member.phone,
        role: member.role,
        permissions: effectivePermissions(
          member.role,
          member.permissionOverrideSet
            ? member.permissionGrants.map(({ permissionCode }) => permissionCode)
            : member.roleRecord.permissions.map(({ permissionCode }) => permissionCode),
        ),
        isActive: member.isActive,
        createdAt: member.createdAt,
      };
    }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser("staff:write");
    const input = staffSchema.parse(await readJson(request));
    if (input.role === "OWNER") throw new HttpError("Owner accounts must be created with owner email and password credentials", 400);
    if (!isStaffRole(input.role)) throw new HttpError("Select a recognized staff role", 400);
    if (input.permissions?.some((permission) => !isPermission(permission))) {
      throw new HttpError("One or more permissions are not recognized", 400);
    }
    const assigned = input.permissions as Permission[] | undefined;
    const resultingPermissions = effectivePermissions(input.role, assigned);
    if (resultingPermissions.some((permission) => !can(actor.role, permission, actor.permissions))) {
      throw new HttpError("You cannot assign permissions you do not have", 403);
    }
    const staff = await prisma.$transaction(async (tx) => {
      const created = await createCredentialUser(tx, { ...input, permissions: assigned });
      await addAudit(tx, {
        userId: actor.id,
        action: "staff.created",
        entity: "User",
        entityId: created.id,
        details: { before: null, after: { role: created.role, isActive: created.isActive, permissions: resultingPermissions } },
      });
      return created;
    });
    return Response.json({
      id: staff.id, name: staff.name, phone: staff.phone, role: staff.role,
      permissions: resultingPermissions, isActive: staff.isActive, accessCode: staff.accessCode,
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
