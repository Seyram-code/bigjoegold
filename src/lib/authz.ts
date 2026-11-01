import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { effectivePermissions, hasPermission, isStaffRole, type Permission, type StaffRole } from "@/lib/permissions";

export type { Permission } from "@/lib/permissions";
export type AuthorizedUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  permissions: Permission[];
};

export async function getCurrentUser(): Promise<AuthorizedUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, email: true, phone: true, role: true, isActive: true, permissionOverrideSet: true,
      roleRecord: { select: { permissions: { select: { permissionCode: true } } } },
      permissionGrants: { select: { permissionCode: true } },
    },
  });
  if (!user || !user.isActive) return null;
  if (!isStaffRole(user.role)) throw new Error(`User ${user.id} has an unknown staff role`);
  const assignedPermissions = user.permissionOverrideSet
    ? user.permissionGrants.map(({ permissionCode }) => permissionCode)
    : user.roleRecord.permissions.map(({ permissionCode }) => permissionCode);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    permissions: effectivePermissions(user.role, assignedPermissions),
  };
}

export function can(role: StaffRole, permission: Permission, overrides?: unknown) {
  return hasPermission(role, permission, overrides);
}

export function userCan(user: Pick<AuthorizedUser, "role" | "permissions">, permission: Permission) {
  return hasPermission(user.role, permission, user.permissions);
}

export function assertPermission(user: Pick<AuthorizedUser, "role" | "permissions">, permission: Permission) {
  if (!userCan(user, permission)) {
    throw new Response("You do not have permission to perform this action", { status: 403 });
  }
}

export async function requireUser(permission?: Permission) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response("Authentication required", { status: 401 });
  }
  if (permission) assertPermission(user, permission);
  return user;
}
