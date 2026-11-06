"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { ZodError, type ZodType } from "zod";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Copy, Eye, KeyRound, Plus, ShieldCheck, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast-provider";
import { DataTable } from "@/components/ui/data-table";
import { DateFilter } from "@/components/ui/date-filter";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { SearchInput } from "@/components/ui/search-input";
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete";
import { PaymentProcessingOverlay } from "@/components/ui/payment-processing-overlay";
import { customerSchema, tradeSchema, paymentSchema, staffSchema, ownerCreateSchema } from "@/lib/validation";
import { formatCurrency, formatPriceAmount, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { fetchAllCustomers } from "@/lib/customer-client";
import { boardPriceUnitLabel } from "@/lib/board-prices";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/workspace-navigation";
import { permissions, type Permission } from "@/lib/permissions";

export type ModuleKey = Exclude<WorkspaceView["module"], "settings">;
type Row = Record<string, unknown>;
type Field = { name: string; label: string; type?: "text" | "email" | "number" | "select" | "textarea" | "date" | "datetime-local" | "password" | "tel"; options?: { value: string; label: string }[]; placeholder?: string; step?: string; full?: boolean; hint?: string };
type FormSpec = { title: string; endpoint: string; schema: ZodType; fields: Field[] };

const currency = formatCurrency;
const formatDate = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" }) : "—";
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const hours = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"].map((value) => ({ value, label: value.replaceAll("_", " ") }));
const customerTypeOptions = [{ value: "INDIVIDUAL", label: "Individual" }, { value: "BUSINESS", label: "Business" }];
const staffRoles = ["OWNER", "MANAGER", "GOLD_RECEIVER", "SALES_OFFICER", "INVENTORY_OFFICER", "TRADER", "ACCOUNTANT", "AUDITOR", "VIEWER"];
const roleOptions = staffRoles.filter((value) => value !== "OWNER").map((value) => ({ value, label: value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) }));
const permissionLabels: Record<Permission, string> = {
  "dashboard:read": "Dashboard",
  "customers:read": "View customers",
  "customers:personal:read": "View customer contact details",
  "customers:export": "Export customer data",
  "customers:write": "Manage customers",
  "trades:read": "View transactions",
  "trades:write": "Legacy combined trade entry",
  "purchases:write": "Record purchases / receive gold",
  "sales:write": "Record sales",
  "transactions:reverse": "Reverse sales",
  "trades:discount": "Apply sales discounts",
  "inventory:read": "View inventory",
  "inventory:adjust": "Adjust / open stock",
  "inventory:transfer": "Transfer stock",
  "inventory:reconcile": "Reconcile stock",
  "payments:read": "View payments",
  "payments:write": "Record payments",
  "finance:manage": "Manage finance accounts",
  "finance:approve": "Approve high-value account adjustments",
  "reports:read": "View and export reports",
  "board:read": "View board prices",
  "board:write": "Change board prices",
  "staff:read": "View staff",
  "staff:write": "Manage staff access",
  "audit:read": "View audit log",
  "settings:manage": "Manage settings",
};

const moduleInfo: Record<ModuleKey, { title: string; description: string; endpoint: string }> = {
  trades: { title: "Gold trading", description: "Record purchases and sales with purity-aware pricing, payments, and live FIFO stock movements.", endpoint: "/api/trades" },
  inventory: { title: "Gold inventory", description: "On-hand stock by purchase lot, with FIFO cost values and assay purity.", endpoint: "/api/inventory" },
  customers: { title: "Customers", description: "Maintain customer records and their trading history.", endpoint: "/api/customers" },
  payments: { title: "Payments", description: "Track incoming customer receipts and outgoing purchase payments.", endpoint: "/api/payments" },
  "board-prices": { title: "Gold board prices", description: "Review currency- and unit-specific prices. Every update is retained in the price history.", endpoint: "/api/board-prices" },
  transactions: { title: "Transactions", description: "Review recorded gold purchases, sales, and payments.", endpoint: "/api/trades" },
  reports: { title: "Financial reports", description: "Review trading performance, stock throughput, cash movement, and balances.", endpoint: "/api/reports" },
  staff: { title: "Staff & access", description: "Create staff accounts and manage roles and account access.", endpoint: "/api/staff" },
  audit: { title: "Audit trail", description: "Review a time-stamped, append-only record of operational changes.", endpoint: "/api/audit" },
};

const formSpecs: Partial<Record<ModuleKey, FormSpec>> = {
  customers: {
    title: "Customer details",
    endpoint: "/api/customers",
    schema: customerSchema,
    fields: [
      { name: "name", label: "Full or business name", placeholder: "e.g. Ama Mensah" },
      { name: "type", label: "Customer type", type: "select", options: customerTypeOptions },
      { name: "phone", label: "Phone", placeholder: "+233 ..." },
      { name: "email", label: "Email", type: "email" },
      { name: "tin", label: "TIN / identification reference" },
      { name: "address", label: "Address", type: "textarea", full: true },
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
  trades: {
    title: "Post a gold trade",
    endpoint: "/api/trades",
    schema: tradeSchema,
    fields: [
      { name: "type", label: "Trade direction", type: "select", options: [{ value: "PURCHASE", label: "Purchase gold" }, { value: "SALE", label: "Sell gold" }] },
      { name: "transactionDate", label: "Trade date and time", type: "datetime-local" },
      { name: "customerId", label: "Customer", type: "select", options: [] },
      { name: "quantityKg", label: "Gross weight (kg)", type: "number", step: "0.000001", placeholder: "0.000000" },
      { name: "purityBps", label: "Purity (basis points)", type: "number", step: "1", placeholder: "9999", hint: "99.99% purity = 9999 basis points." },
      { name: "pricePerGram", label: "Rate (GHS / pure gram)", type: "number", step: "0.01", placeholder: "Enter current agreed rate" },
      { name: "initialPayment", label: "Payment now (GHS)", type: "number", step: "0.01", placeholder: "0.00" },
      { name: "cashAccountId", label: "Cash / bank account", type: "select", options: [] },
      { name: "method", label: "Payment method", type: "select", options: hours },
      { name: "note", label: "Trade notes", type: "textarea", full: true },
    ],
  },
  payments: {
    title: "Record a payment",
    endpoint: "/api/payments",
    schema: paymentSchema,
    fields: [
      { name: "tradeId", label: "Trade", type: "select", options: [] },
      { name: "direction", label: "Direction", type: "select", options: [{ value: "INBOUND", label: "Money received" }, { value: "OUTBOUND", label: "Money paid" }] },
      { name: "amount", label: "Amount (GHS)", type: "number", step: "0.01", placeholder: "0.00" },
      { name: "cashAccountId", label: "Cash / bank account", type: "select", options: [] },
      { name: "method", label: "Payment method", type: "select", options: hours },
      { name: "paidAt", label: "Payment date and time", type: "datetime-local" },
      { name: "note", label: "Reference or note", type: "textarea", full: true },
    ],
  },
  staff: {
    title: "Create staff account",
    endpoint: "/api/staff",
    schema: staffSchema,
    fields: [
      { name: "name", label: "Staff name" },
      { name: "phone", label: "Phone number", type: "tel" },
      { name: "role", label: "Role", type: "select", options: roleOptions },
    ],
  },
};

const columns: Partial<Record<ModuleKey, { label: string; key: string }[]>> = {
  customers: [{ label: "Customer", key: "name" }, { label: "Code", key: "code" }, { label: "Type", key: "type" }, { label: "Phone", key: "phone" }, { label: "Trades", key: "_count.trades" }, { label: "Added", key: "createdAt" }],
  trades: [{ label: "Reference", key: "reference" }, { label: "Direction", key: "type" }, { label: "Customer", key: "customer.name" }, { label: "Weight", key: "quantityKg" }, { label: "Purity", key: "purityBps" }, { label: "Rate / g", key: "pricePerGram" }, { label: "Value", key: "totalAmount" }, { label: "Paid", key: "paid" }, { label: "Balance", key: "balance" }, { label: "Date", key: "transactionDate" }],
  inventory: [{ label: "Purchase lot", key: "trade.reference" }, { label: "Received", key: "originalGrams" }, { label: "Remaining", key: "remainingGrams" }, { label: "Purity", key: "purityBps" }, { label: "Cost / g", key: "costPerGram" }, { label: "Added", key: "createdAt" }],
  payments: [{ label: "Reference", key: "reference" }, { label: "Direction", key: "direction" }, { label: "Amount", key: "amount" }, { label: "Method", key: "method" }, { label: "Allocated to", key: "allocation" }, { label: "Customer", key: "customer.name" }, { label: "Paid at", key: "paidAt" }],
  "board-prices": [{ label: "Price", key: "priceAmount" }, { label: "Currency", key: "currency" }, { label: "Unit", key: "priceUnit" }, { label: "Source", key: "source" }, { label: "Note", key: "note" }, { label: "Published by", key: "createdBy.name" }, { label: "Effective", key: "effectiveAt" }],
  staff: [{ label: "Name", key: "name" }, { label: "Phone", key: "phone" }, { label: "Role", key: "role" }, { label: "Status", key: "isActive" }, { label: "Joined", key: "createdAt" }],
  audit: [{ label: "Action", key: "action" }, { label: "Record", key: "entity" }, { label: "Record ID", key: "entityId" }, { label: "By", key: "user.name" }, { label: "Details", key: "details" }, { label: "Time", key: "createdAt" }],
  transactions: [{ label: "Reference", key: "reference" }, { label: "Type", key: "recordType" }, { label: "Customer", key: "customer.name" }, { label: "Gold weight", key: "quantityKg" }, { label: "Amount", key: "value" }, { label: "Date", key: "eventDate" }],
};

const defaultValues: Partial<Record<ModuleKey, Record<string, string>>> = {
  customers: { name: "", kind: "BUYER", type: "INDIVIDUAL", phone: "", email: "", tin: "", address: "", notes: "" },
  trades: { type: "PURCHASE", transactionDate: localDateTime(), customerId: "", quantityKg: "", purityBps: "9999", pricePerGram: "", initialPayment: "0", cashAccountId: "", method: "CASH", note: "" },
  payments: { tradeId: "", direction: "INBOUND", amount: "", cashAccountId: "", method: "CASH", paidAt: localDateTime(), note: "" },
  staff: { name: "", phone: "", role: "TRADER" },
};

export function OperationsPanel({ module, canWrite, canResetOwnerPassword = false, canCreateOwner = false, actorUserId, view }: { module: ModuleKey; canWrite: boolean; canResetOwnerPassword?: boolean; canCreateOwner?: boolean; actorUserId?: string; view?: WorkspaceView }) {
  const info = moduleInfo[module];
  const spec = formSpecs[module];
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row | null>(null);
  const [references, setReferences] = useState<{ customers: Row[]; trades: Row[]; accounts: Row[] }>({ customers: [], trades: [], accounts: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [pendingStaffAction, setPendingStaffAction] = useState<{ row: Row; values: Partial<{ role: string; isActive: boolean }> } | null>(null);
  const [pendingCodeReset, setPendingCodeReset] = useState<Row | null>(null);
  const [pendingOwnerPasswordReset, setPendingOwnerPasswordReset] = useState<Row | null>(null);
  const [ownerResetPassword, setOwnerResetPassword] = useState("");
  const [ownerResetConfirmation, setOwnerResetConfirmation] = useState("");
  const [viewedAccessCode, setViewedAccessCode] = useState<{ name: string; code: string } | null>(null);
  const [accessCodeCopied, setAccessCodeCopied] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<{ id: string; values: Permission[] } | null>(null);
  const [staffActionBusy, setStaffActionBusy] = useState(false);
  const [showForm, setShowForm] = useState(view?.openForm ?? false);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [ownerForm, setOwnerForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [ownerFormBusy, setOwnerFormBusy] = useState(false);
  const { success: showToast } = useToast();
  const [reportFrom, setReportFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const load = useCallback(async () => {
    try {
      const path = module === "reports"
        ? `${info.endpoint}?from=${encodeURIComponent(`${reportFrom}T00:00:00.000Z`)}&to=${encodeURIComponent(`${reportTo}T23:59:59.999Z`)}`
        : info.endpoint;
      if (module === "transactions") {
        const [tradesResponse, paymentsResponse] = await Promise.all([
          fetch("/api/trades", { cache: "no-store" }),
          fetch("/api/payments", { cache: "no-store" }),
        ]);
        const [tradesBody, paymentsBody] = await Promise.all([tradesResponse.json(), paymentsResponse.json()]);
        if (!tradesResponse.ok) throw new Error(readMessage(tradesBody, "Unable to load trade transactions"));
        if (!paymentsResponse.ok) throw new Error(readMessage(paymentsBody, "Unable to load payment transactions"));
        const trades = asRows(tradesBody).map((row) => ({ ...row, recordType: row.type, value: row.totalAmount, eventDate: row.transactionDate ?? row.createdAt }));
        const payments = asRows(paymentsBody).map((row) => ({ ...row, recordType: `PAYMENT · ${stringValue(row.direction)}`, value: row.amount, eventDate: row.paidAt }));
        setRows([...trades, ...payments].sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate))));
        setSummary(null);
        setError("");
      } else {
        const response = await fetch(path, { cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(readMessage(body, "Unable to load this page"));
        setError("");
        if (module === "inventory" && isRecord(body)) {
          setSummary(isRecord(body.summary) ? body.summary : null);
          setRows(asRows(body.lots));
        } else if (module === "reports" && isRecord(body)) {
          setSummary(isRecord(body.totals) ? body.totals : null);
          setRows([]);
        } else {
          setSummary(null);
          setRows(asRows(body));
        }
      }
      if (module === "trades" || module === "payments") {
        const [customers, tradesResponse, accountsResponse] = await Promise.all([
          fetchAllCustomers<Row & { id: string }>(view?.tradeType === "PURCHASE" ? "SUPPLIER" : "BUYER"),
          fetch("/api/trades", { cache: "no-store" }),
          fetch("/api/finance/accounts", { cache: "no-store" }),
        ]);
        const [trades, accounts] = await Promise.all([tradesResponse.json(), accountsResponse.json()]);
        if (!accountsResponse.ok) throw new Error(readMessage(accounts, "Unable to load cash accounts"));
        setReferences({
          customers,
          trades: asRows(trades), accounts: asRows(accounts),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this page");
    } finally {
      setLoading(false);
    }
  }, [info.endpoint, module, reportFrom, reportTo, view?.tradeType]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load);

  const formDefaults = useMemo(() => ({ ...(defaultValues[module] ?? {}), ...(view?.tradeType ? { type: view.tradeType } : {}) }), [module, view?.tradeType]);
  const form = useForm<Record<string, string>>({ defaultValues: formDefaults });
  const resetForm = form.reset;
  useEffect(() => {
    setShowForm(view?.openForm ?? false);
    if (!spec) return;
    if (editing && module === "customers") {
      resetForm({
        name: stringValue(editing.name),
        type: stringValue(editing.type),
        phone: stringValue(editing.phone),
        email: stringValue(editing.email),
        tin: stringValue(editing.tin),
        address: stringValue(editing.address),
        notes: stringValue(editing.notes),
      });
    } else {
      resetForm(formDefaults);
    }
  }, [editing, formDefaults, module, resetForm, spec, view?.href, view?.openForm]);

  async function submit(values: Record<string, string>) {
    setError("");
    form.clearErrors();
    try {
      const payload: Record<string, unknown> = { ...values };
      for (const dateField of ["transactionDate", "paidAt"]) {
        const value = payload[dateField];
        if (typeof value === "string" && value) payload[dateField] = new Date(value).toISOString();
      }
      const validated = spec?.schema.parse(payload);
      const response = await fetch(editing ? `${spec?.endpoint}/${String(editing.id)}` : spec?.endpoint ?? "", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to save this record"));
      if (module === "staff" && isRecord(body) && typeof body.accessCode === "string") {
        showToast(`Staff account created. Copy this one-time access code and share it securely.\nAccess code: ${body.accessCode}`, 0);
      } else {
        showToast(editing ? "Customer details updated." : `${spec?.title.replace(/^./, (letter) => letter.toLowerCase())} saved successfully.`);
      }
      setEditing(null);
      form.reset(defaultValues[module] ?? {});
      if (module === "staff") setShowForm(false);
      await load();
    } catch (cause) {
      if (cause instanceof ZodError) {
        for (const issue of cause.issues) {
          const fieldName = issue.path[0];
          if (typeof fieldName === "string") form.setError(fieldName, { type: "validate", message: issue.message });
        }
        return;
      }
      setError(cause instanceof Error ? cause.message : "Unable to save this record");
    }
  }

  async function submitOwner() {
    setError("");
    try {
      const input = ownerCreateSchema.parse(ownerForm);
      setOwnerFormBusy(true);
      const response = await fetch("/api/staff/owners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to create owner account"));
      setOwnerForm({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
      setShowOwnerForm(false);
      showToast("Owner account created. Share the sign-in email and password securely.");
      await load();
    } catch (cause) {
      if (cause instanceof ZodError) {
        const message = cause.issues[0]?.message;
        setError(message ?? "Check the owner account details and try again.");
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to create owner account");
      }
    } finally {
      setOwnerFormBusy(false);
    }
  }

  async function resetOwnerPassword(row: Row) {
    if (ownerResetPassword.length < 12) {
      setError("Owner passwords must be at least 12 characters.");
      return;
    }
    if (ownerResetPassword !== ownerResetConfirmation) {
      setError("The new password and confirmation do not match.");
      return;
    }
    setStaffActionBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/staff/${String(row.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: ownerResetPassword }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to reset owner password"));
      setPendingOwnerPasswordReset(null);
      setOwnerResetPassword("");
      setOwnerResetConfirmation("");
      showToast(`Password reset for ${stringValue(row.name)}. Their active sessions have been signed out.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reset owner password");
    } finally {
      setStaffActionBusy(false);
    }
  }

  async function generateAccessCode(row: Row) {
    setError("");
    setStaffActionBusy(true);
    try {
      const response = await fetch(`/api/staff/${String(row.id)}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to generate an access code"));
      if (!isRecord(body) || typeof body.accessCode !== "string") throw new Error("The server did not return a new access code");
      showToast(`New one-time access code generated for ${stringValue(row.name)}. Share it securely.\nAccess code: ${body.accessCode}`, 0);
      setPendingCodeReset(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate an access code");
    } finally {
      setStaffActionBusy(false);
    }
  }

  async function viewAccessCode(row: Row) {
    setError("");
    setStaffActionBusy(true);
    try {
      const response = await fetch(`/api/staff/${String(row.id)}/access-code`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to view the access code"));
      if (!isRecord(body) || typeof body.accessCode !== "string" || typeof body.name !== "string") throw new Error("The server did not return an access code");
      setViewedAccessCode({ name: body.name, code: body.accessCode });
      setAccessCodeCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to view the access code");
    } finally {
      setStaffActionBusy(false);
    }
  }

  async function copyViewedAccessCode() {
    if (!viewedAccessCode) return;
    try {
      await navigator.clipboard.writeText(viewedAccessCode.code);
      setAccessCodeCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? `Unable to copy the access code: ${cause.message}` : "Unable to copy the access code");
    }
  }

  async function updateStaff(row: Row, values: Partial<{ role: string; isActive: boolean; permissions: Permission[] }>) {
    setError("");
    setStaffActionBusy(true);
    try {
      const response = await fetch(`/api/staff/${String(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(body, "Unable to update staff access"));
      showToast(values.permissions ? "Staff permissions updated." : values.isActive === false ? "Staff access has been deactivated." : values.isActive === true ? "Staff access has been restored." : "Staff role updated.");
      setPendingStaffAction(null);
      setEditingPermissions(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update staff access");
    } finally {
      setStaffActionBusy(false);
    }
  }

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (view?.filter === "sales" && module === "trades" && row.type !== "SALE") return false;
    if (view?.filter === "purchases" && module === "trades" && row.type !== "PURCHASE") return false;
    if ((view?.filter === "inbound" || view?.filter === "outbound") && module === "payments" && row.direction !== view.filter.toUpperCase()) return false;
    if (view?.filter === "sales-payments" && module === "payments" && !(row.direction === "INBOUND" && isRecord(row.trade) && row.trade.type === "SALE")) return false;
    if (module === "transactions" && view?.filter === "sales" && row.recordType !== "SALE") return false;
    if (module === "transactions" && view?.filter === "purchases" && row.recordType !== "PURCHASE") return false;
    const text = Object.values(row).map((value) => flatten(value)).join(" ").toLowerCase();
    return text.includes(query.toLowerCase());
  }), [module, query, rows, view?.filter]);

  const inventoryStats = module === "inventory" && summary ? [
    ["Available gold", formatWeight(number(summary.kilograms))],
    ["Available weight", formatWeight(number(summary.grams), "g")],
    ["FIFO book value", currency(number(summary.costValue))],
    ["Market valuation", summary.marketValue === null ? "Compatible GHS / pure-gram price required" : currency(number(summary.marketValue))],
    ["Unrealized gross margin", summary.unrealizedGrossMargin === null ? "—" : currency(number(summary.unrealizedGrossMargin))],
    ["Weighted purity", `${formatDecimalTruncated(number(summary.weightedPurityBps) / 100, 2)}%`],
  ] : [];
  const reportStats = module === "reports" && summary ? [
    ["Gross sales", currency(number(summary.sales))],
    ["Purchases", currency(number(summary.purchases))],
    ["Profit", summary.profit === null ? "Unavailable" : currency(number(summary.profit))],
    ["Cash received", currency(number(summary.cashIn))],
    ["Cash paid", currency(number(summary.cashOut))],
    ["Trade throughput", `${formatWeight(number(summary.purchasedKg))} in · ${formatWeight(number(summary.soldKg))} out`],
  ] : [];
  const boardCurrent = module === "board-prices" ? rows[0] : undefined;
  const tableRows: Row[] = module === "trades" ? filteredRows.map((row): Row => {
    const paid = asRows(row.payments).reduce((sum, payment) => sum + number(payment.amount), 0);
    return { ...row, paid, balance: Math.max(0, number(row.totalAmount ?? row.amount) - paid) };
  }) : filteredRows;
  const actionColumn = canWrite && (module === "customers" || module === "staff");

  return <>
  <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium text-[#8b949e]">Workspace / {view?.label ?? info.title}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{view?.label ?? info.title}</h1><p className="mt-1.5 max-w-2xl text-sm text-[#76808c]">{view?.notice ?? info.description}</p></div>
      <div className="flex items-center gap-2">
        <RefreshButton loading={loading} onClick={() => { setLoading(true); void load(); }} />
        {spec && canWrite && <Button variant="gold" size="sm" onClick={() => { setEditing(null); if (module === "staff") setShowOwnerForm(false); setShowForm((value) => !value); }}><Plus size={14} /> {showForm ? "Close form" : view?.tradeType === "SALE" ? "New sale" : view?.tradeType === "PURCHASE" ? "Receive stock" : module === "customers" ? "New customer" : module === "trades" ? "New trade" : module === "staff" ? "Add staff" : module === "board-prices" ? "Publish rate" : "Record payment"}</Button>}
        {module === "staff" && canCreateOwner && <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setShowOwnerForm((value) => !value); }}><Plus size={14} /> {showOwnerForm ? "Close owner form" : "Add owner"}</Button>}
      </div>
    </div>

    {view?.notice && <AlertDialog open title="Notice" variant="warning" description={view.notice} onConfirm={() => {}} />}
    <AlertDialog open={Boolean(error)} title="Operations error" description={error} onConfirm={() => setError("")} />

    {inventoryStats.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{inventoryStats.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>}
    {reportStats.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{reportStats.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>}
    {module === "reports" && summary && <p className="rounded-lg border border-[#e8ebef] bg-white px-4 py-3 text-xs leading-5 text-[#63707e]">{String(resolve(summary, "profitAvailability.explanation") ?? "Profit is not calculated from gross sales.")} Method: {String(resolve(summary, "profitAvailability.method") ?? "Net sales value minus the recorded cost of gold sold or released.")}</p>}
    {module === "reports" && <DateFilter from={reportFrom} to={reportTo} onFromChange={setReportFrom} onToChange={setReportTo} onApply={() => { setLoading(true); void load(); }} busy={loading} />}
    {module === "board-prices" && <Card className="border-[#d6aa42] bg-[#fff0c2]"><CardContent className="flex flex-col justify-between gap-3 py-5 sm:flex-row sm:items-center"><div><p className="text-xs font-medium text-[#795719]">Current published board rate</p><p className="mt-1 text-2xl font-semibold text-[#17212f]">{boardCurrent ?     `${formatPriceAmount(String(boardCurrent.priceAmount), String(boardCurrent.currency))} / ${boardPriceUnitLabel(String(boardCurrent.priceUnit))}` : "No board price yet"}</p></div>{boardCurrent && <div className="text-left sm:text-right"><p className="text-xs text-[#795719]">{String(boardCurrent.source)}</p><p className="mt-1 text-[11px] text-[#8b7657]">Effective {formatDate(boardCurrent.effectiveAt)}</p></div>}</CardContent></Card>}
    {spec && canWrite && showForm && <div
      className={module === "staff" ? "fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]" : "contents"}
      onMouseDown={(event) => {
        if (module === "staff" && event.target === event.currentTarget && !form.formState.isSubmitting) setShowForm(false);
      }}
    >
      <section
        role={module === "staff" ? "dialog" : undefined}
        aria-modal={module === "staff" ? true : undefined}
        aria-labelledby={module === "staff" ? "staff-create-title" : undefined}
        className={module === "staff" ? "max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl" : "contents"}
      >
    <Card className="border-[#e3d4b8]"><CardHeader className="flex-row items-center justify-between pb-3"><div><CardTitle id={module === "staff" ? "staff-create-title" : undefined}>{editing ? "Update customer" : spec.title}</CardTitle><p className="mt-1 text-[11px] text-[#8a939e]">{module === "trades" ? "Amounts are calculated from pure weight and the entered price; inventory changes only when the trade commits." : module === "payments" ? "A payment must be allocated to a trade and cannot exceed its outstanding balance." : "Fields marked required must be completed."}</p></div><button type="button" disabled={form.formState.isSubmitting} onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-md p-1.5 text-[#8c95a0] hover:bg-[#f1f3f5] disabled:opacity-50" aria-label="Close form"><X size={16} /></button></CardHeader><CardContent><form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {spec.fields.map((field) => {
        const options = getFieldOptions(field, module, references);
        const fieldError = form.formState.errors[field.name]?.message;
        const fieldId = `field-${field.name}`;
        return <FormField key={field.name} label={field.label} htmlFor={fieldId} hint={field.hint} error={fieldError ? String(fieldError) : undefined} className={cn(field.full && "sm:col-span-2 xl:col-span-3")}>
          {field.type === "textarea" ? <textarea id={fieldId} rows={3} placeholder={field.placeholder} {...form.register(field.name)} className={cn(fieldControlClass, "h-auto resize-y py-2.5")} /> :
            module === "trades" && field.name === "customerId" ? <CustomerAutocomplete
              id={fieldId}
              customers={references.customers.filter((row) => row.isActive !== false).map((row) => ({
                id: stringValue(row.id),
                name: stringValue(row.name),
                code: stringValue(row.code),
                phone: typeof row.phone === "string" ? row.phone : null,
              }))}
              value={form.watch(field.name) ?? ""}
              onChange={(customerId) => form.setValue(field.name, customerId, { shouldDirty: true, shouldValidate: true })}
              placeholder="Search customer or choose walk-in"
            /> :
              field.type === "select" ? <select id={fieldId} {...form.register(field.name)} className={fieldControlClass}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> :
              <input id={fieldId} type={field.type ?? "text"} step={field.step} max={field.type === "datetime-local" ? localDateTime() : undefined} placeholder={field.placeholder} {...form.register(field.name)} className={fieldControlClass} />}
        </FormField>;
      })}
      {module === "trades" && <p className="text-[10px] leading-4 text-[#89929e] sm:col-span-2 xl:col-span-3">Price is in Ghana cedis per gram of pure gold. Quantity is gross physical weight in kilograms. Sales are rejected if available FIFO stock is insufficient.</p>}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-3"><Button type="submit" variant="gold" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving…" : editing ? "Save changes" : "Save record"}</Button><Button type="button" variant="outline" onClick={() => { form.reset(defaultValues[module] ?? {}); setEditing(null); }}>Clear</Button></div>
    </form></CardContent></Card>
      </section>
    </div>}

    {module === "staff" && canCreateOwner && showOwnerForm && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !ownerFormBusy) setShowOwnerForm(false);
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="owner-create-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl">
    <Card className="border-[#d6aa42]">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div><CardTitle id="owner-create-title">Create owner account</CardTitle><p className="mt-1 text-[11px] text-[#8a939e]">Owners have full access and sign in with their email and password.</p></div>
        <button type="button" disabled={ownerFormBusy} onClick={() => setShowOwnerForm(false)} className="rounded-md p-1.5 text-[#8c95a0] hover:bg-[#f1f3f5] disabled:opacity-50" aria-label="Close owner form"><X size={16} /></button>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => { event.preventDefault(); void submitOwner(); }} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FormField label="Owner name" htmlFor="new-owner-name"><input id="new-owner-name" autoComplete="name" required minLength={2} maxLength={120} value={ownerForm.name} onChange={(event) => setOwnerForm((current) => ({ ...current, name: event.target.value }))} className={fieldControlClass} /></FormField>
          <FormField label="Email address" htmlFor="new-owner-email"><input id="new-owner-email" type="email" autoComplete="email" required maxLength={254} value={ownerForm.email} onChange={(event) => setOwnerForm((current) => ({ ...current, email: event.target.value }))} className={fieldControlClass} /></FormField>
          <FormField label="Phone number" htmlFor="new-owner-phone"><input id="new-owner-phone" type="tel" autoComplete="tel" required minLength={6} maxLength={40} value={ownerForm.phone} onChange={(event) => setOwnerForm((current) => ({ ...current, phone: event.target.value }))} className={fieldControlClass} /></FormField>
          <FormField label="Password" htmlFor="new-owner-password" hint="Use 12–128 characters."><input id="new-owner-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={ownerForm.password} onChange={(event) => setOwnerForm((current) => ({ ...current, password: event.target.value }))} className={fieldControlClass} /></FormField>
          <FormField label="Confirm password" htmlFor="new-owner-confirm-password"><input id="new-owner-confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={ownerForm.confirmPassword} onChange={(event) => setOwnerForm((current) => ({ ...current, confirmPassword: event.target.value }))} className={fieldControlClass} /></FormField>
          <div className="flex items-end gap-2"><Button type="submit" variant="gold" disabled={ownerFormBusy}>{ownerFormBusy ? "Creating…" : "Create owner"}</Button><Button type="button" variant="outline" disabled={ownerFormBusy} onClick={() => setOwnerForm({ name: "", email: "", phone: "", password: "", confirmPassword: "" })}>Clear</Button></div>
        </form>
      </CardContent>
    </Card>
      </section>
    </div>}

    {module === "staff" && <Card className="staff-role-info border-blue-100 bg-blue-50/50"><CardContent className="py-3 text-xs leading-5 text-blue-800"><p>Role templates set starting access. Administrators can assign individual permissions, which are checked by the server on every operation. Deactivation preserves historical records.</p><p className="mt-2 text-[10px]"><strong>Owner:</strong> full control · <strong>Manager:</strong> operations and approvals · <strong>Gold Receiver:</strong> purchases · <strong>Sales Officer:</strong> sales · <strong>Inventory Officer:</strong> stock · <strong>Accountant:</strong> finance and reports · <strong>Read-only Auditor:</strong> review access.</p></CardContent></Card>}

    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div><CardTitle>{module === "reports" ? "Report summary" : module === "audit" ? "Recent activity" : module === "inventory" ? "Available inventory lots" : module === "board-prices" ? "Published price history" : module === "staff" ? "Team accounts" : `Recent ${info.title.toLowerCase()}`}</CardTitle><p className="mt-1 text-[11px] text-[#89929d]">{loading ? "Loading records…" : `${filteredRows.length} ${filteredRows.length === 1 ? "record" : "records"} shown`}</p></div>
        {module !== "reports" && <SearchInput value={query} onChange={setQuery} className="w-full sm:w-56" />}
      </CardHeader>
      <DataTable
        key={query}
        columns={columns[module] ?? []}
        rows={tableRows}
        rowKey={(row, index) => stringValue(row.id ?? row.category ?? index)}
        loading={loading}
        extraColumn={actionColumn}
        emptyMessage={query ? "No records match your search." : "Nothing recorded here yet."}
      >
        {(row) => <>
          {(columns[module] ?? []).map((column) => <td key={column.key} className="max-w-[220px] truncate px-4 py-3.5 text-xs text-[#63707e] first:pl-5">{renderCell(module, column.key, resolve(row, column.key), row)}</td>)}
          {module === "customers" && canWrite && <td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => { setEditing(row); setShowForm(true); }}>Edit</Button></td>}
          {module === "staff" && canWrite && <td className="px-4 py-3">
            <div className="w-full min-w-[220px] max-w-[340px] space-y-2">
              <label className="sr-only" htmlFor={`staff-role-${String(row.id)}`}>Role for {stringValue(row.name)}</label>
              <select
                id={`staff-role-${String(row.id)}`}
                value={String(row.role)}
                onChange={(event) => setPendingStaffAction({ row, values: { role: event.target.value } })}
                className="h-8 w-full rounded-lg border border-[#e4e8ed] bg-[#f8f9fb] px-3 text-xs font-semibold text-[#354252] outline-none transition-colors hover:border-[#c5ccd5] focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15"
              >
                {staffRoles.filter((role) => role !== "OWNER" || row.role === "OWNER").map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
              </select>
              <div className="flex flex-wrap gap-1.5">
                {row.role !== "OWNER" && Boolean(row.isActive) && <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-[#e4e8ed] px-2.5 text-[11px] text-[#526071] hover:border-[#cbd3dd] hover:bg-[#f8f9fb]"
                  disabled={staffActionBusy}
                  onClick={() => { void viewAccessCode(row); }}
                >
                  <Eye size={13} /> View code
                </Button>}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-[#e4e8ed] px-2.5 text-[11px] text-[#526071] hover:border-[#cbd3dd] hover:bg-[#f8f9fb]"
                  onClick={() => setEditingPermissions({ id: String(row.id), values: stringArray(row.permissions).filter((permission): permission is Permission => permissions.includes(permission as Permission)) })}
                >
                  <ShieldCheck size={13} /> Permissions
                </Button>
                {row.role !== "OWNER" && <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-[#d6aa42] bg-[#f5e3b0] px-2.5 text-[11px] text-[#795719] hover:bg-[#f1d98c]"
                  disabled={!row.isActive}
                  onClick={() => setPendingCodeReset(row)}
                >
                  <KeyRound size={13} /> New code
                </Button>}
                {row.role === "OWNER" && canResetOwnerPassword && String(row.id) !== actorUserId && <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-[#d6aa42] bg-[#f5e3b0] px-2.5 text-[11px] text-[#795719] hover:bg-[#f1d98c]"
                  onClick={() => { setError(""); setOwnerResetPassword(""); setOwnerResetConfirmation(""); setPendingOwnerPasswordReset(row); }}
                >
                  <KeyRound size={13} /> Reset password
                </Button>}
                <Button
                  size="sm"
                  variant={row.isActive ? "outline" : "primary"}
                  className={cn("h-8 gap-1.5 px-2.5 text-[11px]", row.isActive ? "border-[#f0d7d7] text-[#a54c4c] hover:border-[#e6baba] hover:bg-[#fff7f7]" : "")}
                  onClick={() => setPendingStaffAction({ row, values: { isActive: !Boolean(row.isActive) } })}
                >
                  {row.isActive ? <><UserRoundX size={13} /> Deactivate</> : <><UserRoundCheck size={13} /> Activate</>}
                </Button>
              </div>
            </div>
          </td>}
        </>}
      </DataTable>
      {module === "payments" && <CardContent className="border-t border-[#edf0f3] pt-4 text-[10px] text-[#89929d]"><span className="inline-flex items-center gap-1"><ArrowDownLeft size={12} className="text-emerald-600" /> inbound is money received</span><span className="mx-4 inline-flex items-center gap-1"><ArrowUpRight size={12} className="text-rose-600" /> outbound is money paid</span><span className="inline-flex items-center gap-1"><ArrowRight size={12} /> every payment is allocated to one record</span></CardContent>}
    </Card>
    {module === "staff" && canWrite && editingPermissions && <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>Assign permissions</CardTitle><p className="mt-1 text-xs text-[#7c8793]">Permissions are saved to this account and enforced by server APIs. Owner access is always full.</p></div>
        <Button size="sm" variant="outline" onClick={() => setEditingPermissions(null)}>Close</Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((permission) => <label key={permission} className="flex items-start gap-2 rounded-lg border border-[#e8ebef] p-3 text-xs text-[#465362]">
            <input
              type="checkbox"
              checked={editingPermissions.values.includes(permission)}
              disabled={rows.find((row) => String(row.id) === editingPermissions.id)?.role === "OWNER"}
              onChange={(event) => setEditingPermissions((current) => current ? {
                ...current,
                values: event.target.checked ? [...current.values, permission] : current.values.filter((value) => value !== permission),
              } : null)}
            />
            <span>{permissionLabels[permission]}</span>
          </label>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="gold" size="sm" disabled={staffActionBusy || rows.find((row) => String(row.id) === editingPermissions.id)?.role === "OWNER"} onClick={() => {
            const row = rows.find((candidate) => String(candidate.id) === editingPermissions.id);
            if (row) void updateStaff(row, { permissions: editingPermissions.values });
          }}>Save permissions</Button>
          <Button variant="outline" size="sm" disabled={staffActionBusy} onClick={() => {
            const row = rows.find((candidate) => String(candidate.id) === editingPermissions.id);
            if (row) void updateStaff(row, { role: String(row.role) });
          }}>Reset to role defaults</Button>
        </div>
      </CardContent>
    </Card>}
    <ConfirmDialog
      open={Boolean(pendingStaffAction)}
      title={pendingStaffAction?.values.isActive === false ? "Deactivate staff access?" : pendingStaffAction?.values.isActive === true ? "Restore staff access?" : "Change staff role?"}
      description={pendingStaffAction?.values.role
        ? `Change ${stringValue(pendingStaffAction.row.name)}'s role to ${pendingStaffAction.values.role.toLowerCase()}? This changes which parts of the trading desk they can access.`
        : pendingStaffAction?.values.isActive === false
          ? `${stringValue(pendingStaffAction.row.name)} will no longer be able to sign in. Their historical trades and audit records will be retained.`
          : `${stringValue(pendingStaffAction?.row.name)} will be able to sign in again using their existing account.`}
      confirmLabel={pendingStaffAction?.values.isActive === false ? "Deactivate access" : pendingStaffAction?.values.isActive === true ? "Restore access" : "Change role"}
      destructive={pendingStaffAction?.values.isActive === false}
      busy={staffActionBusy}
      onCancel={() => setPendingStaffAction(null)}
      onConfirm={() => { if (pendingStaffAction) void updateStaff(pendingStaffAction.row, pendingStaffAction.values); }}
    />
    <ConfirmDialog
      open={Boolean(pendingCodeReset)}
      title="Generate a new access code?"
      description={pendingCodeReset ? `This immediately replaces ${stringValue(pendingCodeReset.name)}'s current code and signs out their active sessions. The new code will be shown once.` : ""}
      confirmLabel="Generate code"
      busy={staffActionBusy}
      onCancel={() => setPendingCodeReset(null)}
      onConfirm={() => { if (pendingCodeReset) void generateAccessCode(pendingCodeReset); }}
    />
    {viewedAccessCode && <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setViewedAccessCode(null);
          setAccessCodeCopied(false);
        }
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="staff-access-code-title" className="w-full max-w-md rounded-2xl border border-[#e8ebef] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.24)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="staff-access-code-title" className="text-base font-semibold text-[#17212f]">Staff access code</h2>
            <p className="mt-1 text-sm text-[#74808d]">{viewedAccessCode.name}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" aria-label="Close access code" onClick={() => { setViewedAccessCode(null); setAccessCodeCopied(false); }}><X size={16} /></Button>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[#e8ebef] bg-[#f7f8fa] px-4 py-4">
          <code className="select-all font-mono text-2xl font-bold tracking-[0.12em] text-[#17212f]">{viewedAccessCode.code}</code>
          <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => { void copyViewedAccessCode(); }}>
            {accessCodeCopied ? <Check size={15} /> : <Copy size={15} />}
            {accessCodeCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-5 text-[#74808d]">Share this code securely with the staff member. Viewing it has been recorded in the audit log.</p>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="gold" onClick={() => { setViewedAccessCode(null); setAccessCodeCopied(false); }}>Done</Button>
        </div>
      </section>
    </div>}
    {pendingOwnerPasswordReset && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !staffActionBusy) setPendingOwnerPasswordReset(null);
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="owner-password-reset-title" className="w-full max-w-md rounded-2xl border border-[#e8ebef] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.24)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="owner-password-reset-title" className="text-base font-semibold text-[#17212f]">Reset owner password</h2>
            <p className="mt-1 text-sm text-[#74808d]">{stringValue(pendingOwnerPasswordReset.name)}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" aria-label="Close password reset" disabled={staffActionBusy} onClick={() => setPendingOwnerPasswordReset(null)}><X size={16} /></Button>
        </div>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">This immediately replaces the password and signs out all active sessions. Use a unique password with at least 12 characters and share it securely.</p>
        <label className="mt-4 block text-xs font-semibold text-[#465362]">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={ownerResetPassword} onChange={(event) => setOwnerResetPassword(event.target.value)} className={`${fieldControlClass} mt-1.5`} /></label>
        <label className="mt-3 block text-xs font-semibold text-[#465362]">Confirm new password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={ownerResetConfirmation} onChange={(event) => setOwnerResetConfirmation(event.target.value)} className={`${fieldControlClass} mt-1.5`} /></label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={staffActionBusy} onClick={() => setPendingOwnerPasswordReset(null)}>Cancel</Button>
          <Button type="button" variant="gold" disabled={staffActionBusy || ownerResetPassword.length < 12 || ownerResetPassword !== ownerResetConfirmation} onClick={() => { void resetOwnerPassword(pendingOwnerPasswordReset); }}>{staffActionBusy ? "Resetting…" : "Reset password"}</Button>
        </div>
      </section>
    </div>}
  </div>
  <PaymentProcessingOverlay message={module === "payments" && form.formState.isSubmitting ? "Recording payment…" : null} />
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-[10px] font-medium text-[#85909b]">{label}</p><p className="mt-2 text-lg font-semibold tracking-tight text-[#17212f]">{value}</p></CardContent></Card>;
}

function getFieldOptions(field: Field, module: ModuleKey, refs: { customers: Row[]; trades: Row[]; accounts: Row[] }) {
  if (module === "trades" && field.name === "customerId") {
    return [{ value: "", label: "Walk-in / no linked customer" }, ...refs.customers.filter((row) => row.isActive !== false).map((row) => ({ value: stringValue(row.id), label: `${stringValue(row.name)} · ${stringValue(row.code)}` }))];
  }
  if (module === "payments" && field.name === "tradeId") {
    return [{ value: "", label: "No trade selected" }, ...refs.trades.map((row) => ({ value: stringValue(row.id), label: `${stringValue(row.reference)} · ${stringValue(row.type)} · ${currency(number(row.totalAmount))}` }))];
  }
  if (["payments", "trades"].includes(module) && field.name === "cashAccountId") {
    return [{ value: "", label: "Select an account" }, ...refs.accounts.filter((row) => row.currency === "GHS" && row.isActive !== false)
      .map((row) => ({ value: stringValue(row.id), label: `${stringValue(row.name)} · ${stringValue(row.type).replaceAll("_", " ")}` }))];
  }
  return [{ value: "", label: "Select…" }, ...(field.options ?? [])];
}

function renderCell(module: ModuleKey, key: string, value: unknown, row: Row) {
  if (module === "payments" && key === "allocation") return stringValue(resolve(row, "trade.reference")) || "—";
  if (key === "details" && value && typeof value === "object") return <span title={JSON.stringify(value)}>{JSON.stringify(value)}</span>;
  if (key.endsWith("At") || key === "createdAt" || key === "transactionDate" || key === "paidAt" || key === "eventDate") return formatDate(value);
  if (["pricePerGram", "costPerGram", "totalAmount", "amount", "value", "paid", "balance", "costValue"].includes(key)) return value === null || value === undefined ? "—" : currency(number(value));
  if (key === "quantityKg") return formatWeight(number(value));
  if (key === "originalGrams" || key === "remainingGrams") return formatWeight(number(value), "g");
  if (key === "purityBps") return `${formatDecimalTruncated(number(value) / 100, 2)}%`;
  if (key === "isActive") return <Badge tone={value ? "green" : "red"}>{value ? "Active" : "Inactive"}</Badge>;
  if (key === "type" || key === "direction") {
    const text = stringValue(value);
    const tone = text === "SALE" || text === "INBOUND" || text === "BUSINESS" ? "green" : text === "PURCHASE" || text === "OUTBOUND" ? "blue" : "neutral";
    return <Badge tone={tone}>{text.replaceAll("_", " ")}</Badge>;
  }
  if (key === "role") return <Badge tone={value === "OWNER" ? "gold" : "neutral"}>{stringValue(value)}</Badge>;
  if (module === "audit" && key === "action") return <span className="font-semibold text-[#344151]">{stringValue(value).replaceAll(".", " ")}</span>;
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function resolve(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, row);
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMessage(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
