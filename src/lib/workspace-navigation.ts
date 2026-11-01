export type WorkspaceModule =
  | "trades"
  | "inventory"
  | "transactions"
  | "customers"
  | "payments"
  | "board-prices"
  | "reports"
  | "staff"
  | "audit"
  | "settings";

export type WorkspaceView = {
  href: string;
  label: string;
  module: WorkspaceModule;
  permission?: "dashboard" | "trades" | "inventory" | "customers" | "payments" | "reports" | "board" | "staff" | "audit" | "settings";
  filter?: "sales" | "purchases" | "inbound" | "outbound" | "sales-payments";
  tradeType?: "SALE" | "PURCHASE";
  customerKind?: "BUYER" | "SUPPLIER";
  openForm?: boolean;
  notice?: string;
};

export type NavigationItem = {
  label: string;
  href: string;
  permission?: WorkspaceView["permission"];
  children?: NavigationItem[];
};

export const workspaceNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/", permission: "dashboard" },
  {
    label: "Customers", href: "/customers", permission: "customers", children: [
      { label: "Sales Customers", href: "/customers", permission: "customers" },
      { label: "Receiving Stock Suppliers", href: "/receiving-suppliers", permission: "customers" },
    ],
  },
  { label: "Receive Stock", href: "/receive-stock", permission: "trades" },
  {
    label: "Sales", href: "/sales/all-sales", permission: "trades", children: [
      { label: "All Sales", href: "/sales/all-sales", permission: "trades" },
      { label: "New Sale", href: "/sales/new-sale", permission: "trades" },
      { label: "Sales History", href: "/sales/history", permission: "trades" },
      { label: "Sales Payments", href: "/sales/payments", permission: "payments" },
      { label: "Returns and Reversals", href: "/sales/returns-reversals", permission: "trades" },
    ],
  },
  {
    label: "Add Stock", href: "/add-stock/opening-stock", permission: "inventory", children: [
      { label: "Opening Stock", href: "/add-stock/opening-stock", permission: "inventory" },
      { label: "Manual Stock Adjustment", href: "/add-stock/manual-adjustment", permission: "inventory" },
      { label: "Stock Transfers", href: "/add-stock/transfers", permission: "inventory" },
    ],
  },
  {
    label: "Inventory", href: "/inventory/current-stock", permission: "inventory", children: [
      { label: "Current Stock", href: "/inventory/current-stock", permission: "inventory" },
      { label: "Gold Batches", href: "/inventory/gold-batches", permission: "inventory" },
      { label: "Stock Movements", href: "/inventory/stock-movements", permission: "inventory" },
      { label: "Low or Negative Stock Alerts", href: "/inventory/stock-alerts", permission: "inventory" },
      { label: "Reconciliation", href: "/inventory/reconciliation", permission: "inventory" },
    ],
  },
  {
    label: "Transactions", href: "/transactions/all-transactions", children: [
      { label: "All Transactions", href: "/transactions/all-transactions", permission: "trades" },
      { label: "Purchase Transactions", href: "/transactions/purchases", permission: "trades" },
      { label: "Sales Transactions", href: "/transactions/sales", permission: "trades" },
      { label: "Payment Transactions", href: "/transactions/payments", permission: "payments" },
    ],
  },
  {
    label: "Gold Price", href: "/gold-price/current-board-price", permission: "board", children: [
      { label: "Current Board Price", href: "/gold-price/current-board-price", permission: "board" },
      { label: "Price History", href: "/gold-price/history", permission: "board" },
      { label: "Price Settings", href: "/gold-price/settings", permission: "board" },
    ],
  },
  { label: "Financing", href: "/finance/financing", permission: "payments" },
  { label: "Manual Bank & MOMO", href: "/manual-momo", permission: "payments" },
  {
    label: "Finance", href: "/finance/accounts", children: [
      { label: "Payments Received", href: "/finance/payments-received", permission: "payments" },
      { label: "Payments Made", href: "/finance/payments-made", permission: "payments" },
      { label: "Cash and Bank Accounts", href: "/finance/accounts", permission: "reports" },
      { label: "Financial Summaries", href: "/finance/summaries", permission: "reports" },
      { label: "Transaction Reconciliation", href: "/finance/reconciliation", permission: "payments" },
    ],
  },
  { label: "Reports", href: "/reports", permission: "reports" },
  { label: "Staff Management", href: "/staff", permission: "staff" },
  { label: "Audit Logs", href: "/audit", permission: "audit" },
  { label: "Settings", href: "/settings", permission: "settings" },
];

const views: WorkspaceView[] = [
  { href: "/customers", label: "Sales Customers", module: "customers", permission: "customers", customerKind: "BUYER" },
  { href: "/receiving-suppliers", label: "Receiving Stock Suppliers", module: "customers", permission: "customers", customerKind: "SUPPLIER" },
  { href: "/receive-stock", label: "Receive Stock", module: "trades", permission: "trades", filter: "purchases", tradeType: "PURCHASE", openForm: true },
  { href: "/sales/all-sales", label: "All Sales", module: "trades", permission: "trades", filter: "sales" },
  { href: "/sales/new-sale", label: "New Sale", module: "trades", permission: "trades", filter: "sales", tradeType: "SALE", openForm: true },
  { href: "/sales/history", label: "Sales History", module: "trades", permission: "trades", filter: "sales" },
  { href: "/sales/payments", label: "Sales Payments", module: "payments", permission: "payments", filter: "sales-payments" },
  { href: "/sales/returns-reversals", label: "Returns and Reversals", module: "trades", permission: "trades", filter: "sales" },
  { href: "/add-stock/opening-stock", label: "Opening Stock", module: "inventory", permission: "inventory" },
  { href: "/add-stock/manual-adjustment", label: "Manual Stock Adjustment", module: "inventory", permission: "inventory" },
  { href: "/add-stock/transfers", label: "Stock Transfers", module: "inventory", permission: "inventory" },
  { href: "/inventory/current-stock", label: "Current Stock", module: "inventory", permission: "inventory" },
  { href: "/inventory/gold-batches", label: "Gold Batches", module: "inventory", permission: "inventory" },
  { href: "/inventory/stock-movements", label: "Stock Movements", module: "inventory", permission: "inventory" },
  { href: "/inventory/stock-alerts", label: "Low or Negative Stock Alerts", module: "inventory", permission: "inventory" },
  { href: "/inventory/reconciliation", label: "Reconciliation", module: "inventory", permission: "inventory" },
  { href: "/transactions/all-transactions", label: "All Transactions", module: "transactions", permission: "trades" },
  { href: "/transactions/purchases", label: "Purchase Transactions", module: "trades", permission: "trades", filter: "purchases" },
  { href: "/transactions/sales", label: "Sales Transactions", module: "trades", permission: "trades", filter: "sales" },
  { href: "/transactions/payments", label: "Payment Transactions", module: "payments", permission: "payments" },
  { href: "/gold-price/current-board-price", label: "Current Board Price", module: "board-prices", permission: "board" },
  { href: "/gold-price/history", label: "Price History", module: "board-prices", permission: "board" },
  { href: "/gold-price/settings", label: "Price Settings", module: "board-prices", permission: "board" },
  { href: "/finance/payments-received", label: "Payments Received", module: "payments", permission: "payments", filter: "inbound" },
  { href: "/finance/payments-made", label: "Payments Made", module: "payments", permission: "payments", filter: "outbound" },
  { href: "/finance/financing", label: "Financing", module: "payments", permission: "payments" },
  { href: "/finance/customer-advances", label: "Supplier Gold Advances", module: "payments", permission: "payments" },
  { href: "/finance/buyer-financing", label: "Customer Gold Financing", module: "payments", permission: "payments" },
  { href: "/manual-momo", label: "Manual Bank & MOMO", module: "payments", permission: "payments" },
  { href: "/finance/accounts", label: "Cash and Bank Accounts", module: "payments", permission: "reports" },
  { href: "/finance/summaries", label: "Financial Summaries", module: "reports", permission: "reports" },
  { href: "/finance/reconciliation", label: "Transaction Reconciliation", module: "payments", permission: "payments" },
  { href: "/reports", label: "Reports", module: "reports", permission: "reports" },
  { href: "/staff", label: "Staff Management", module: "staff", permission: "staff" },
  { href: "/audit", label: "Audit Logs", module: "audit", permission: "audit" },
  { href: "/settings", label: "Settings", module: "settings", permission: "settings" },
];

export function getWorkspaceView(path: string): WorkspaceView | null {
  return views.find((view) => view.href === path) ?? null;
}
