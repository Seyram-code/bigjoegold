export const staffRoles = [
  "OWNER", "MANAGER", "GOLD_RECEIVER", "SALES_OFFICER", "INVENTORY_OFFICER",
  "ACCOUNTANT", "AUDITOR", "TRADER", "VIEWER",
] as const;

export type StaffRole = (typeof staffRoles)[number];

export const permissions = [
  "dashboard:read",
  "customers:read",
  "customers:personal:read",
  "customers:export",
  "customers:write",
  "trades:read",
  "trades:write",
  "purchases:write",
  "sales:write",
  "transactions:reverse",
  "trades:discount",
  "inventory:read",
  "inventory:adjust",
  "inventory:transfer",
  "inventory:reconcile",
  "payments:read",
  "payments:write",
  "finance:manage",
  "finance:approve",
  "reports:read",
  "board:read",
  "board:write",
  "staff:read",
  "staff:write",
  "audit:read",
  "settings:manage",
] as const;

export type Permission = (typeof permissions)[number];

const allPermissions = [...permissions];

export const rolePermissions: Record<StaffRole, Permission[]> = {
  OWNER: allPermissions,
  MANAGER: [
    "dashboard:read", "customers:read", "customers:personal:read", "customers:export", "customers:write",
    "trades:read", "trades:write", "purchases:write", "sales:write", "transactions:reverse", "trades:discount",
    "inventory:read", "inventory:adjust", "inventory:transfer", "inventory:reconcile",
    "payments:read", "payments:write", "finance:manage", "finance:approve",
    "reports:read", "board:read", "board:write", "staff:read", "audit:read",
  ],
  GOLD_RECEIVER: [
    "dashboard:read", "customers:read", "customers:personal:read", "customers:write", "trades:read", "purchases:write",
    "inventory:read", "payments:read", "payments:write", "board:read",
  ],
  SALES_OFFICER: [
    "dashboard:read", "customers:read", "customers:personal:read", "customers:write", "trades:read", "sales:write",
    "inventory:read", "payments:read", "payments:write", "board:read",
  ],
  INVENTORY_OFFICER: [
    "dashboard:read", "trades:read", "inventory:read", "inventory:adjust", "inventory:transfer", "inventory:reconcile",
  ],
  ACCOUNTANT: [
    "dashboard:read", "customers:read", "customers:personal:read", "customers:export", "trades:read", "payments:read",
    "payments:write", "finance:manage", "finance:approve", "reports:read", "board:read", "audit:read",
  ],
  AUDITOR: [
    "dashboard:read", "customers:read", "trades:read", "inventory:read", "payments:read",
    "reports:read", "board:read", "audit:read",
  ],
  TRADER: [
    "dashboard:read", "customers:read", "customers:personal:read", "customers:write", "trades:read", "trades:write",
    "purchases:write", "sales:write", "inventory:read", "payments:read", "payments:write", "board:read",
  ],
  VIEWER: [
    "dashboard:read", "customers:read", "trades:read", "inventory:read", "payments:read",
    "reports:read", "board:read", "audit:read",
  ],
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (staffRoles as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (permissions as readonly string[]).includes(value);
}

export function effectivePermissions(role: StaffRole, overrides?: unknown): Permission[] {
  if (role === "OWNER") return [...rolePermissions.OWNER];
  if (Array.isArray(overrides)) return [...new Set(overrides.filter(isPermission))];
  return [...rolePermissions[role]];
}

export function hasPermission(role: StaffRole, permission: Permission, overrides?: unknown) {
  return effectivePermissions(role, overrides).includes(permission);
}
