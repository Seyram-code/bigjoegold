import { Dashboard } from "@/components/dashboard";
import { can, getCurrentUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return <Dashboard
    canWriteTrades={Boolean(user && (can(user.role, "purchases:write", user.permissions) || can(user.role, "sales:write", user.permissions)))}
    canWriteCustomers={Boolean(user && can(user.role, "customers:write", user.permissions))}
    canWriteInventory={Boolean(user && can(user.role, "inventory:adjust", user.permissions))}
    canReadReports={Boolean(user && can(user.role, "reports:read", user.permissions))}
  />;
}
