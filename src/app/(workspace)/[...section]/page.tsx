import { notFound } from "next/navigation";
import { getCurrentUser, can, type Permission } from "@/lib/authz";
import { OperationsPanel, type ModuleKey } from "@/components/operations-panel";
import { SettingsPage } from "@/components/settings-page";
import { CustomerManagement } from "@/components/customer-management";
import { ReceiveStock } from "@/components/receive-stock";
import { InventoryManagement, type InventoryView } from "@/components/inventory-management";
import { GoldPriceManagement } from "@/components/gold-price-management";
import { SalesManagement } from "@/components/sales-management";
import { FinanceManagement, type FinanceView } from "@/components/finance-management";
import { ReportsDashboard } from "@/components/reports-dashboard";
import { FinancingManagement } from "@/components/financing-management";
import { ManualMomo } from "@/components/manual-momo";
import { ManualMomoContacts } from "@/components/manual-momo-contacts";
import { MansoBranchManagement } from "@/components/manso-branch-management";
import { ExpensesManagement } from "@/components/expenses-management";
import { getWorkspaceView, type WorkspaceModule, type WorkspaceView } from "@/lib/workspace-navigation";

export const dynamic = "force-dynamic";

const readPermission: Record<NonNullable<WorkspaceView["permission"]>, Permission> = {
  dashboard: "dashboard:read",
  customers: "customers:read",
  trades: "trades:read",
  inventory: "inventory:read",
  payments: "payments:read",
  reports: "reports:read",
  board: "board:read",
  staff: "staff:read",
  audit: "audit:read",
  settings: "settings:manage",
};

const writePermission: Partial<Record<WorkspaceModule, Permission>> = {
  trades: "trades:write",
  customers: "customers:write",
  payments: "payments:write",
  "board-prices": "board:write",
  staff: "staff:write",
};

const legacyViews: Record<string, WorkspaceView> = {
  trades: { href: "/trades", label: "Gold trading", module: "trades", permission: "trades" },
  inventory: { href: "/inventory", label: "Gold inventory", module: "inventory", permission: "inventory" },
  payments: { href: "/payments", label: "Payments", module: "payments", permission: "payments" },
  "board-prices": { href: "/board-prices", label: "Gold board prices", module: "board-prices", permission: "board" },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const path = `/${section.join("/")}`;
  const view = getWorkspaceView(path) ?? (section.length === 1 ? legacyViews[section[0]] : undefined);
  if (!view) notFound();
  const user = await getCurrentUser();
  if (view.permission && (!user || !can(user.role, readPermission[view.permission], user.permissions))) notFound();
  if (view.module === "settings") return <SettingsPage />;
  if (path === "/expenses") return <ExpensesManagement
    canManage={Boolean(user && can(user.role, "finance:manage", user.permissions))}
    canApprove={Boolean(user && can(user.role, "finance:approve", user.permissions))}
  />;
  if (path === "/finance/financing") return <FinancingManagement
    canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))}
    canCreateCustomer={Boolean(user && can(user.role, "customers:write", user.permissions))}
    canFulfill={Boolean(user && can(user.role, "payments:write", user.permissions) && can(user.role, "sales:write", user.permissions) && can(user.role, "inventory:read", user.permissions))}
  />;
  if (path === "/manso-branch") return <MansoBranchManagement
    canManageFunds={Boolean(user && can(user.role, "finance:manage", user.permissions))}
    canReceiveGold={Boolean(user && can(user.role, "purchases:write", user.permissions) && can(user.role, "payments:write", user.permissions))}
  />;
  if (path === "/finance/customer-advances") return <FinancingManagement
    canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))}
    canCreateCustomer={Boolean(user && can(user.role, "customers:write", user.permissions))}
    canFulfill={Boolean(user && can(user.role, "payments:write", user.permissions) && can(user.role, "sales:write", user.permissions) && can(user.role, "inventory:read", user.permissions))}
  />;
  if (path === "/finance/buyer-financing") return <FinancingManagement
    canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))}
    canCreateCustomer={Boolean(user && can(user.role, "customers:write", user.permissions))}
    canFulfill={Boolean(user && can(user.role, "payments:write", user.permissions) && can(user.role, "sales:write", user.permissions) && can(user.role, "inventory:read", user.permissions))}
    initialTab="buyer-financing"
  />;
  if (path.startsWith("/finance/")) {
    const financeView = path.slice("/finance/".length) as FinanceView;
    if (["payments-received", "payments-made", "accounts", "summaries", "reconciliation"].includes(financeView)) {
      return <FinanceManagement
        view={financeView}
        canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))}
        canManage={Boolean(user && can(user.role, "finance:manage", user.permissions))}
        canApprove={Boolean(user && can(user.role, "finance:approve", user.permissions))}
      />;
    }
  }
  const inventoryViews: Record<string, InventoryView> = {
    "/add-stock/opening-stock": "opening",
    "/add-stock/manual-adjustment": "adjustment",
    "/add-stock/transfers": "transfers",
    "/inventory/current-stock": "current",
    "/inventory/gold-batches": "batches",
    "/inventory/stock-movements": "movements",
    "/inventory/stock-alerts": "alerts",
    "/inventory/reconciliation": "reconciliation",
  };
  if (view.module === "inventory") return <InventoryManagement
    view={inventoryViews[path] ?? "current"}
    canOpen={Boolean(user && can(user.role, "inventory:adjust", user.permissions))}
    canAdjust={Boolean(user && can(user.role, "inventory:adjust", user.permissions))}
    canTransfer={Boolean(user && can(user.role, "inventory:transfer", user.permissions))}
    canReconcile={Boolean(user && can(user.role, "inventory:reconcile", user.permissions))}
  />;
  if (path === "/receive-stock") {
    return <ReceiveStock
      canWrite={Boolean(user && can(user.role, "purchases:write", user.permissions))}
      canCreateCustomer={Boolean(user && can(user.role, "customers:write", user.permissions))}
      canReadPersonal={Boolean(user && can(user.role, "customers:personal:read", user.permissions))}
      canUseBuyerFinancing={Boolean(user && can(user.role, "payments:read", user.permissions) && can(user.role, "payments:write", user.permissions))}
      recordedBy={user?.name ?? "—"}
    />;
  }
  if (path === "/manual-momo") {
    return <ManualMomo canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))} />;
  }
  if (path === "/manual-momo/contacts") {
    return <ManualMomoContacts canWrite={Boolean(user && can(user.role, "payments:write", user.permissions))} />;
  }
  if (path.startsWith("/sales/")) {
    const salesView = path.endsWith("/new-sale") ? "new"
      : path.endsWith("/history") ? "history"
        : path.endsWith("/payments") ? "payments"
          : path.endsWith("/returns-reversals") ? "returns"
            : "all";
    return <SalesManagement
      view={salesView}
      canWrite={Boolean(user && can(user.role, "sales:write", user.permissions))}
      canDiscount={Boolean(user && can(user.role, "trades:discount", user.permissions))}
      canCreateBuyer={Boolean(user && can(user.role, "customers:write", user.permissions))}
    />;
  }
  if (view.module === "board-prices") {
    const sectionName = path.endsWith("/history") ? "history" : path.endsWith("/settings") ? "settings" : "current";
    return <GoldPriceManagement section={sectionName} canWrite={Boolean(user && can(user.role, "board:write", user.permissions))} />;
  }
  if (view.module === "customers") {
    return <CustomerManagement
      kind={view.customerKind ?? "BUYER"}
      canWrite={Boolean(user && can(user.role, "customers:write", user.permissions))}
      canReadPersonal={Boolean(user && can(user.role, "customers:personal:read", user.permissions))}
      canReadTrades={Boolean(user && can(user.role, "trades:read", user.permissions))}
      canExport={Boolean(user && can(user.role, "customers:export", user.permissions))}
    />;
  }
  if (view.module === "reports") return <ReportsDashboard />;
  const moduleKey = view.module as ModuleKey;
  const permission = writePermission[moduleKey];
  return <OperationsPanel module={moduleKey} canWrite={permission ? Boolean(user && can(user.role, permission, user.permissions)) : false} canResetOwnerPassword={user?.role === "OWNER"} canCreateOwner={user?.role === "OWNER"} actorUserId={user?.id} view={view} />;
}
