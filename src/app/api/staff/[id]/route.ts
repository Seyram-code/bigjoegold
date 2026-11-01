import { prisma } from "@/lib/prisma";
import { addAudit } from "@/lib/records";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { staffUpdateSchema } from "@/lib/validation";
import { effectivePermissions, isPermission, isStaffRole } from "@/lib/permissions";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireUser("staff:write");
    const { id } = await params;
    const input = staffUpdateSchema.parse(await readJson(request));
    if (id === actor.id && input.isActive === false) throw new HttpError("You cannot deactivate your own account", 400);
    if (id === actor.id && (input.role !== undefined || input.permissions !== undefined)) {
      throw new HttpError("You cannot change your own role or permissions", 400);
    }
    if (input.role !== undefined && !isStaffRole(input.role)) {
      throw new HttpError("Select a recognized staff role", 400);
    }

    const staff = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        include: { permissionGrants: { select: { permissionCode: true } } },
      });
      if (!current) throw new HttpError("Staff member not found", 404);
      if (!isStaffRole(current.role)) throw new Error(`Staff member ${current.id} has an unknown role`);
      const currentRole = current.role;
      const role = input.role ?? currentRole;
      if (input.role === "OWNER" && currentRole !== "OWNER") {
        throw new HttpError("Staff cannot be promoted to owner from this screen", 400);
      }
      if (role === "OWNER" && actor.role !== "OWNER") throw new HttpError("Only an owner can assign the owner role", 403);
      if (input.permissions?.some((permission) => !isPermission(permission))) {
        throw new HttpError("One or more permissions are not recognized", 400);
      }
      const shouldResetPermissions = input.role !== undefined && input.permissions === undefined;
      const permissionOverrides = shouldResetPermissions
        ? undefined
        : input.permissions ?? (current.permissionOverrideSet
          ? current.permissionGrants.map(({ permissionCode }) => permissionCode)
          : undefined);
      const resultingPermissions = effectivePermissions(role, permissionOverrides);
      if (resultingPermissions.some((permission) => !can(actor.role, permission, actor.permissions))) {
        throw new HttpError("You cannot assign permissions you do not have", 403);
      }
      if (currentRole === "OWNER" && current.isActive && (role !== "OWNER" || input.isActive === false)) {
        const owners = await tx.user.count({ where: { role: "OWNER", isActive: true } });
        if (owners < 2) throw new HttpError("At least one active owner must remain", 400);
      }

      const before = {
        role: currentRole,
        isActive: current.isActive,
        permissions: effectivePermissions(
          currentRole,
          current.permissionOverrideSet
            ? current.permissionGrants.map(({ permissionCode }) => permissionCode)
            : undefined,
        ),
      };
      await tx.user.update({
        where: { id },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.permissions !== undefined || shouldResetPermissions
            ? {
              permissionOverrideSet: input.permissions !== undefined,
              permissionGrants: {
                deleteMany: {},
                ...(input.permissions !== undefined
                  ? { create: input.permissions.map((permissionCode) => ({ permissionCode })) }
                  : {}),
              },
            }
            : {}),
        },
      });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id },
        include: { permissionGrants: { select: { permissionCode: true } } },
      });
      if (!isStaffRole(updated.role)) throw new Error(`Staff member ${updated.id} has an unknown role`);
      await addAudit(tx, {
        userId: actor.id,
        action: "staff.updated",
        entity: "User",
        entityId: id,
        details: {
          before,
          after: { role: updated.role, isActive: updated.isActive, permissions: resultingPermissions },
        },
      });
      return updated;
    });
    if (!isStaffRole(staff.role)) throw new Error(`Staff member ${staff.id} has an unknown role`);
    return Response.json({
      id: staff.id,
      name: staff.name,
      phone: staff.phone,
      role: staff.role,
      permissions: effectivePermissions(
        staff.role,
        staff.permissionOverrideSet
          ? staff.permissionGrants.map(({ permissionCode }) => permissionCode)
          : undefined,
      ),
      isActive: staff.isActive,
    });
  } catch (error) {
    return apiError(error);
  }
}
