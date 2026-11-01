import { redirect } from "next/navigation";
import { getCurrentUser, can } from "@/lib/authz";
import { WorkspaceShell } from "@/components/workspace-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const permissions = {
    dashboard: can(user.role, "dashboard:read", user.permissions),
    customers: can(user.role, "customers:read", user.permissions),
    trades: can(user.role, "trades:read", user.permissions),
    inventory: can(user.role, "inventory:read", user.permissions),
    payments: can(user.role, "payments:read", user.permissions),
    reports: can(user.role, "reports:read", user.permissions),
    board: can(user.role, "board:read", user.permissions),
    staff: can(user.role, "staff:read", user.permissions),
    audit: can(user.role, "audit:read", user.permissions),
    settings: can(user.role, "settings:manage", user.permissions),
  };
  return <WorkspaceShell user={{ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }} permissions={permissions}>{children}</WorkspaceShell>;
}
