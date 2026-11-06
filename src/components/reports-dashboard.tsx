"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Download, Gem, Printer, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { formatCurrency, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { downloadExcelWorkbook, type ExcelSheet } from "@/lib/excel-export";
import { groupTradeTotals, type ReportGrouping } from "@/lib/reporting";

type ReportRow = Record<string, string | number | boolean | null>;
type PaymentRow = ReportRow & {
  accountId: string | null;
  method: string;
  direction: "INBOUND" | "OUTBOUND";
  amount: number;
};
type PaymentAccount = { id: string; name: string; type: string; currency: string; isActive: boolean };
const UNASSIGNED_ACCOUNT = "__unassigned__";
type StatementRow = {
  id: string;
  date: string;
  account: string;
  activity: string;
  reference: string;
  details: string;
  increase: number;
  decrease: number;
  balance: number;
};
type FinancingStatement = {
  type: "customer-advances" | "buyer-financing";
  customerName: string;
  customerCode: string;
  customerPhone: string | null;
  phoneRestricted: boolean;
  balance: number;
  rows: StatementRow[];
};
type ReportData = {
  period: { from: string; to: string };
  totals: {
    sales: number;
    purchases: number;
    costOfSales: number;
    profit: number | null;
    grossMargin: number | null;
    returnOnCost: number | null;
    cashIn: number;
    cashOut: number;
    netCashFlow: number;
    purchasedKg: number;
    soldKg: number;
    tradeCount: number;
    inventoryValue: number | null;
    inventoryKg: number | null;
  };
  profitAvailability: { method: string; explanation: string };
  trades: ReportRow[];
  inventory: ReportRow[] | null;
  payments: PaymentRow[] | null;
  paymentAccounts: PaymentAccount[] | null;
  outstandingTrades: ReportRow[] | null;
  cashMovements: ReportRow[] | null;
  stockMovements: ReportRow[] | null;
  staffActivity: ReportRow[] | null;
  boardPrices: ReportRow[] | null;
  financing: ReportRow[] | null;
  financingAccounts: ReportRow[] | null;
  supplierDailySummary: ReportRow[] | null;
  buyerFinancingDailySummary: ReportRow[] | null;
};

type Column = {
  key: string;
  label: string;
  format?: "currency" | "kg" | "grams" | "date" | "day" | "percent";
};
type TabId = "overview" | "trading" | "inventory" | "customers" | "customer-advances" | "buyer-financing" | "payments" | "payment-methods" | "cash-flow" | "movements" | "staff" | "board";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "trading", label: "Purchases & sales" },
  { id: "inventory", label: "Current stock" },
  { id: "customers", label: "Customer history" },
  { id: "customer-advances", label: "Supplier gold advances" },
  { id: "buyer-financing", label: "Customer gold financing" },
  { id: "payments", label: "Payments & balances" },
  { id: "payment-methods", label: "Account statements" },
  { id: "cash-flow", label: "Cash flow" },
  { id: "movements", label: "Stock movements" },
  { id: "staff", label: "Staff activity" },
  { id: "board", label: "Board price history" },
];

const currency = (value: unknown) => formatCurrency(Number(value ?? 0));
const weight = (value: unknown) => formatWeight(Number(value ?? 0));
const grams = (value: unknown) => formatWeight(Number(value ?? 0), "g");
const date = (value: unknown) => value
  ? new Date(String(value)).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })
  : "—";
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

function startDateValue(dateValue: Date) {
  return new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function makeColumns(...values: Column[]) {
  return values;
}

function displayValue(value: unknown, format?: Column["format"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "currency") return currency(value);
  if (format === "kg") return weight(value);
  if (format === "grams") return grams(value);
  if (format === "date") return date(value);
  if (format === "day") return new Date(String(value)).toLocaleDateString("en-GH", { dateStyle: "medium", timeZone: "UTC" });
  if (format === "percent") return `${formatDecimalTruncated(Number(value) * 100, 2)}%`;
  return text(value);
}

function ReportTable({ rows, columns, emptyMessage, onCustomerClick, onStatementClick }: {
  rows: ReportRow[];
  columns: Column[];
  emptyMessage?: string;
  onCustomerClick?: (customerId: string) => void;
  onStatementClick?: (customerId: string, customerName: string) => void;
}) {
  return <div className="overflow-x-auto rounded-lg border border-[#e8ebef]">
    <table className="w-full min-w-[720px] text-left text-xs">
      <thead className="bg-[#f7f8fa] text-[10px] uppercase tracking-wide text-[#7c8793]">
        <tr>{columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">{column.label}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-[#edf0f2] bg-white">
        {rows.map((row, index) => <tr key={String(row.id ?? row.reference ?? row.period ?? index)} className="text-[#495564]">
          {columns.map((column) => <td key={column.key} className={column.key === "statement" ? "whitespace-nowrap px-4 py-3" : "max-w-[280px] truncate whitespace-nowrap px-4 py-3"}>
            {column.key === "statement" && typeof row.customerId === "string" && onStatementClick
              ? <Button type="button" variant="outline" size="sm" onClick={() => onStatementClick(String(row.customerId), String(row.customer ?? "Customer"))}><Printer size={13} /> Generate statement</Button>
              : column.key === "customer" && typeof row.customerId === "string" && onCustomerClick
              ? <button type="button" onClick={() => onCustomerClick(String(row.customerId))} className="font-medium text-left text-[#8d641f] hover:underline">{displayValue(row.customer)}</button>
              : displayValue(row[column.key], column.format)}
          </td>)}
        </tr>)}
        {!rows.length && <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-[#89929d]">{emptyMessage ?? "No records in this date range."}</td></tr>}
      </tbody>
    </table>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#e8ebef] bg-white p-4">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#89929d]">{label}</p>
    <p className="mt-2 text-lg font-semibold tracking-tight text-[#17212f]">{value}</p>
  </div>;
}

function buildSheets(data: ReportData, groupedTrades: ReportRow[]): ExcelSheet[] {
  const sheets: ExcelSheet[] = [
    {
      name: "Overview",
      rows: [
        ["Metric", "Value"],
        ["Period from", data.period.from],
        ["Period to", data.period.to],
        ["Sales value (GHS)", data.totals.sales],
        ["Purchase value (GHS)", data.totals.purchases],
        ["Profit (GHS)", data.totals.profit],
        ["Gross margin (% of sales)", data.totals.grossMargin === null ? null : data.totals.grossMargin * 100],
        ["Return on cost (% of cost)", data.totals.returnOnCost === null ? null : data.totals.returnOnCost * 100],
        ["Cash received (GHS)", data.totals.cashIn],
        ["Cash paid (GHS)", data.totals.cashOut],
        ["Net cash flow (GHS)", data.totals.netCashFlow],
        ["Purchased (kg)", data.totals.purchasedKg],
        ["Sold (kg)", data.totals.soldKg],
        ["Current stock (kg)", data.totals.inventoryKg],
        ["Inventory valuation (GHS)", data.totals.inventoryValue],
      ],
    },
    { name: "Purchase and sales", rows: [Object.keys(groupedTrades[0] ?? { period: "", purchasesKg: 0, purchaseValue: 0, salesKg: 0, salesValue: 0 }), ...groupedTrades.map((row) => Object.values(row))] },
    { name: "Trade transactions", rows: [Object.keys(data.trades[0] ?? { reference: "", type: "", transactionDate: "", customer: "", quantityKg: 0, karat: 0, netAmount: 0, profit: null, grossMargin: null, returnOnCost: null, paidAmount: 0, balance: 0, createdBy: "" }), ...data.trades.map((row) => Object.values(row))] },
  ];
  if (data.inventory) sheets.push({ name: "Current stock", rows: [Object.keys(data.inventory[0] ?? { batchNumber: "", remainingKg: 0, karat: 0, bookValue: 0, location: "" }), ...data.inventory.map((row) => Object.values(row))] });
  const optional: Array<[string, ReportRow[] | null]> = [
    ["Payments", data.payments],
    ["Open trade balances", data.outstandingTrades],
    ["Cash movements", data.cashMovements],
    ["Stock movements", data.stockMovements],
    ["Staff activity", data.staffActivity],
    ["Board price history", data.boardPrices],
  ];
  for (const [name, rows] of optional) {
    if (!rows) continue;
    const headers = Object.keys(rows[0] ?? { reference: "", date: "", amount: 0 });
    sheets.push({ name, rows: [headers, ...rows.map((row) => headers.map((header) => row[header] ?? null))] });
  }
  if (data.payments && data.paymentAccounts) {
    const accountRows = data.paymentAccounts.map((account) => {
      const accountPayments = data.payments!.filter((payment) => payment.accountId === account.id);
      const received = accountPayments.filter((payment) => payment.direction === "INBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const paid = accountPayments.filter((payment) => payment.direction === "OUTBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      return [account.name, account.type, account.currency, accountPayments.length, received, paid, received - paid];
    });
    const unassignedPayments = data.payments.filter((payment) => payment.accountId === null);
    if (unassignedPayments.length) {
      const received = unassignedPayments.filter((payment) => payment.direction === "INBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const paid = unassignedPayments.filter((payment) => payment.direction === "OUTBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      accountRows.push(["Unassigned account", "—", "GHS", unassignedPayments.length, received, paid, received - paid]);
    }
    sheets.push({
      name: "Cash account summary",
      rows: [["Cash account", "Account type", "Currency", "Transactions", "Money received", "Money paid", "Net movement"], ...accountRows],
    });
  }
  for (const [name, type] of [["Customer gold advances", "Customer gold advance"], ["Buyer gold financing", "Buyer gold financing"]] as const) {
    const activity = data.financing?.filter((row) => row.type === type) ?? [];
    const accounts = data.financingAccounts?.filter((row) => row.type === type) ?? [];
    for (const [suffix, rows] of [["activity", activity], ["accounts", accounts]] as const) {
      if (!data.financing || !data.financingAccounts) continue;
      const sheetName = `${name} ${suffix}`;
      const headers = Object.keys(rows[0] ?? (suffix === "activity"
        ? { date: "", customer: "", accountReference: "", activity: "", reference: "", relatedReference: "", amount: 0 }
        : { customer: "", accountReference: "", balance: 0, balanceMeaning: "" }));
      sheets.push({ name: sheetName, rows: [headers, ...rows.map((row) => headers.map((header) => row[header] ?? null))] });
    }
  }
  if (data.supplierDailySummary) sheets.push({
    name: "Supplier daily summary",
    rows: [
      ["Date", "Stock received (kg)", "Sales / purchase value (GHS)", "Balance due (GHS)"],
      ...data.supplierDailySummary.map((row) => [row.date, row.stockKg, row.sales, row.balance]),
    ],
  });
  if (data.buyerFinancingDailySummary) sheets.push({
    name: "Customer financing daily",
    rows: [
      ["Date", "Customer", "Stock (kg)", "Financing (GHS)", "Balance (GHS)"],
      ...data.buyerFinancingDailySummary.map((row) => [row.date, row.customer, row.stockKg, row.financing, row.balance]),
    ],
  });
  return sheets;
}

function printFinancingSummary() {
  const clearPrintTarget = () => {
    delete document.body.dataset.printTarget;
  };
  document.body.dataset.printTarget = "financing-summary";
  window.addEventListener("afterprint", clearPrintTarget, { once: true });
  window.print();
}

export function ReportsDashboard() {
  const now = new Date();
  const [from, setFrom] = useState(startDateValue(now));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [grouping, setGrouping] = useState<ReportGrouping>("day");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedPaymentAccountId, setSelectedPaymentAccountId] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerDetail, setCustomerDetail] = useState<Record<string, unknown> | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerModalName, setCustomerModalName] = useState("");
  const [statement, setStatement] = useState<FinancingStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState("");
  const statementRequestId = useRef(0);

  async function openCustomer(customerId: string) {
    setCustomerDetail(null);
    setCustomerError("");
    setCustomerLoading(true);
    setCustomerModalOpen(true);
    setCustomerModalName("Customer details");
    try {
      const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Unable to load customer details";
        throw new Error(message);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The server returned invalid customer details");
      const customer = body as Record<string, unknown>;
      setCustomerDetail(customer);
      setCustomerModalName(typeof customer.name === "string" ? customer.name : "Customer details");
    } catch (cause) {
      setCustomerError(cause instanceof Error ? cause.message : "Unable to load customer details");
    } finally {
      setCustomerLoading(false);
    }
  }

  async function openStatement(customerId: string, customerName: string, type: FinancingStatement["type"]) {
    const requestId = ++statementRequestId.current;
    setStatement({ type, customerName, customerCode: "", customerPhone: null, phoneRestricted: false, balance: 0, rows: [] });
    setStatementError("");
    setStatementLoading(true);
    try {
      const endpoint = type === "customer-advances" ? "/api/customer-advances" : "/api/buyer-financing";
      const [response, customerResponse] = await Promise.all([
        fetch(`${endpoint}?customerId=${encodeURIComponent(customerId)}`, { cache: "no-store" }),
        fetch(`/api/customers/${encodeURIComponent(customerId)}`, { cache: "no-store" }),
      ]);
      const [body, customerBody]: [unknown, unknown] = await Promise.all([response.json(), customerResponse.json()]);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Unable to load financing statement";
        throw new Error(message);
      }
      if (!customerResponse.ok) {
        const message = customerBody && typeof customerBody === "object" && "error" in customerBody ? String(customerBody.error) : "Unable to load customer contact details";
        throw new Error(message);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The server returned an invalid financing statement");
      if (!customerBody || typeof customerBody !== "object" || Array.isArray(customerBody)) throw new Error("The server returned invalid customer contact details");
      const customerDetails = customerBody as Record<string, unknown>;
      const customerPhone = typeof customerDetails.phone === "string" && customerDetails.phone.trim() ? customerDetails.phone : null;
      const phoneRestricted = !("phone" in customerDetails);
      const rows: Omit<StatementRow, "balance">[] = [];
      let totalBalancePesewas = 0;
      let name = customerName;
      let code = "";
      if (type === "customer-advances") {
        const payload = body as { advances?: Array<{
          id: string;
          reference: string;
          balance: string | number;
          customer: { id: string; name: string; code: string };
          payments: Array<{ reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; method: string; paidAt: string; note: string | null; cashAccount: { name: string } | null }>;
          requests: Array<{ reference: string; fulfillments: Array<{ reference: string; createdAt: string; grams: string | number; amount: string | number; pricePerGram: string | number; trade: { reference: string } }> }>;
        }> };
        if (!Array.isArray(payload.advances)) throw new Error("No customer advance statement data was returned");
        for (const advance of payload.advances.filter((item) => item.customer.id === customerId)) {
          name = advance.customer.name;
          code = advance.customer.code;
          totalBalancePesewas += Math.round(Number(advance.balance) * 100);
          rows.push(...advance.payments.map((payment) => ({
            id: `${advance.id}-${payment.reference}`,
            date: payment.paidAt,
            account: advance.reference,
            activity: payment.direction === "INBOUND" ? "Advance received" : "Refund paid",
            reference: payment.reference,
            details: [payment.method.replaceAll("_", " "), payment.cashAccount?.name, payment.note].filter(Boolean).join(" · "),
            increase: payment.direction === "INBOUND" ? Number(payment.amount) : 0,
            decrease: payment.direction === "OUTBOUND" ? Number(payment.amount) : 0,
          })));
          rows.push(...advance.requests.flatMap((request) => request.fulfillments.map((fulfillment) => ({
            id: `${advance.id}-${fulfillment.reference}`,
            date: fulfillment.createdAt,
            account: advance.reference,
            activity: "Gold released",
            reference: fulfillment.reference,
            details: `${formatWeight(fulfillment.grams, "g", 2)} at GHS ${fulfillment.pricePerGram}/pure g · Trade ${fulfillment.trade.reference} · Request ${request.reference}`,
            increase: 0,
            decrease: Number(fulfillment.amount),
          }))));
        }
      } else {
        const payload = body as { accounts?: Array<{
          id: string;
          reference: string;
          balance: string | number;
          customer: { id: string; name: string; code: string };
          payments: Array<{ reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; method: string; paidAt: string; note: string | null; cashAccount: { name: string } | null }>;
          settlements: Array<{ reference: string; amount: string | number; createdAt: string; trade: { reference: string; quantityKg: string | number; purityBps: number } }>;
        }> };
        if (!Array.isArray(payload.accounts)) throw new Error("No buyer financing statement data was returned");
        for (const account of payload.accounts.filter((item) => item.customer.id === customerId)) {
          name = account.customer.name;
          code = account.customer.code;
          totalBalancePesewas += Math.round(Number(account.balance) * 100);
          rows.push(...account.payments.map((payment) => ({
            id: `${account.id}-${payment.reference}`,
            date: payment.paidAt,
            account: account.reference,
            activity: payment.direction === "OUTBOUND" ? "Cash advance paid" : "Cash returned",
            reference: payment.reference,
            details: [payment.method.replaceAll("_", " "), payment.cashAccount?.name, payment.note].filter(Boolean).join(" · "),
            increase: payment.direction === "OUTBOUND" ? Number(payment.amount) : 0,
            decrease: payment.direction === "INBOUND" ? Number(payment.amount) : 0,
          })));
          rows.push(...account.settlements.map((settlement) => ({
            id: `${account.id}-${settlement.reference}`,
            date: settlement.createdAt,
            account: account.reference,
            activity: "Gold purchase applied",
            reference: settlement.reference,
            details: `${(Number(settlement.trade.quantityKg) * 1000).toLocaleString("en-GH", { maximumFractionDigits: 2 })} g · ${settlement.trade.purityBps / 100}% purity · Trade ${settlement.trade.reference}`,
            increase: 0,
            decrease: Number(settlement.amount),
          })));
        }
      }
      rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id));
      let balancePesewas = 0;
      const statementRows = rows.map((row) => {
        balancePesewas += Math.round(row.increase * 100) - Math.round(row.decrease * 100);
        return { ...row, balance: balancePesewas / 100 };
      });
      if (requestId === statementRequestId.current) {
        setStatement({ type, customerName: name, customerCode: code, customerPhone, phoneRestricted, balance: totalBalancePesewas / 100, rows: statementRows });
      }
    } catch (cause) {
      if (requestId === statementRequestId.current) {
        setStatementError(cause instanceof Error ? cause.message : "Unable to load financing statement");
      }
    } finally {
      if (requestId === statementRequestId.current) setStatementLoading(false);
    }
  }

  function closeStatement() {
    statementRequestId.current += 1;
    setStatement(null);
    setStatementLoading(false);
    setStatementError("");
  }

  function closeCustomer() {
    setCustomerModalOpen(false);
    setCustomerDetail(null);
    setCustomerError("");
  }

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/reports?${params.toString()}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Unable to load reports";
        throw new Error(message);
      }
      setData(body as ReportData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load reports");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);
  useAutoRefresh(() => load(true));

  const groupedTrades = useMemo(() => groupTradeTotals((data?.trades ?? []).map((trade) => ({
    transactionDate: String(trade.transactionDate),
    type: String(trade.type),
    quantityKg: Number(trade.quantityKg),
    netAmount: Number(trade.netAmount),
  })), grouping), [data?.trades, grouping]);

  const inventoryByKarat = useMemo(() => {
    const byKarat = new Map<string, { karat: number; kilograms: number; value: number }>();
    for (const lot of data?.inventory ?? []) {
      const karat = Number(lot.karat ?? 0);
      const row = byKarat.get(String(karat)) ?? { karat, kilograms: 0, value: 0 };
      row.kilograms += Number(lot.remainingKg ?? 0);
      row.value += Number(lot.bookValue ?? 0);
      byKarat.set(String(karat), row);
    }
    return [...byKarat.values()].sort((a, b) => a.karat - b.karat).map((row) => ({
      karat: row.karat,
      kilograms: row.kilograms,
      value: row.value,
    }));
  }, [data?.inventory]);

  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === "inventory" || tab.id === "movements") return data?.inventory !== null;
    if (tab.id === "payments") return data?.payments !== null;
    if (tab.id === "payment-methods") return data?.payments !== null && data?.paymentAccounts !== null;
    if (tab.id === "customer-advances" || tab.id === "buyer-financing") return data?.financing !== null;
    if (tab.id === "staff") return data?.staffActivity !== null;
    if (tab.id === "board") return data?.boardPrices !== null;
    return true;
  });

  const tradeColumns = makeColumns(
    { key: "transactionDate", label: "Date", format: "date" },
    { key: "reference", label: "Reference" },
    { key: "type", label: "Type" },
    { key: "customer", label: "Customer" },
    { key: "quantityKg", label: "Weight", format: "kg" },
    { key: "karat", label: "Karat" },
    { key: "netAmount", label: "Value", format: "currency" },
    { key: "profit", label: "Profit", format: "currency" },
    { key: "grossMargin", label: "Gross margin (% of sale)", format: "percent" },
    { key: "returnOnCost", label: "Return on cost (%)", format: "percent" },
    { key: "paidAmount", label: "Paid", format: "currency" },
    { key: "balance", label: "Balance", format: "currency" },
    { key: "createdBy", label: "Recorded by" },
  );
  const groupedColumns = makeColumns(
    { key: "period", label: "Period" },
    { key: "purchasesKg", label: "Purchased", format: "kg" },
    { key: "purchaseValue", label: "Purchase value", format: "currency" },
    { key: "salesKg", label: "Sold", format: "kg" },
    { key: "salesValue", label: "Sales value", format: "currency" },
  );
  const inventoryColumns = makeColumns(
    { key: "batchNumber", label: "Batch" },
    { key: "remainingKg", label: "Current stock", format: "kg" },
    { key: "karat", label: "Karat" },
    { key: "purityBps", label: "Purity (bps)" },
    { key: "bookValue", label: "Book value", format: "currency" },
    { key: "costPerGram", label: "Cost / gram", format: "currency" },
    { key: "location", label: "Location" },
    { key: "status", label: "Status" },
  );
  const paymentColumns = makeColumns(
    { key: "paidAt", label: "Date", format: "date" },
    { key: "reference", label: "Reference" },
    { key: "direction", label: "Direction" },
    { key: "amount", label: "Amount", format: "currency" },
    { key: "method", label: "Method" },
    { key: "customer", label: "Customer" },
    { key: "tradeReference", label: "Trade" },
    { key: "account", label: "Account" },
  );
  const sheets = useMemo(() => data ? buildSheets(data, groupedTrades) : [], [data, groupedTrades]);
  function exportExcel() {
    if (!data) return;
    downloadExcelWorkbook(`Big-Joe-Gold-Reports-${from}-to-${to}.xls`, sheets);
  }

  const metrics = data ? [
    ["Purchase value", currency(data.totals.purchases)],
    ["Sales value", currency(data.totals.sales)],
    ["Profit", data.totals.profit === null ? "Unavailable" : currency(data.totals.profit)],
    ["Gross margin (% of sale)", data.totals.grossMargin === null ? "Unavailable" : `${formatDecimalTruncated(data.totals.grossMargin * 100, 2)}%`],
    ["Return on cost", data.totals.returnOnCost === null ? "Unavailable" : `${formatDecimalTruncated(data.totals.returnOnCost * 100, 2)}%`],
    ["Inventory valuation", data.totals.inventoryValue === null ? "Restricted" : currency(data.totals.inventoryValue)],
    ["Current stock", data.totals.inventoryKg === null ? "Restricted" : weight(data.totals.inventoryKg)],
    ["Net cash flow", currency(data.totals.netCashFlow)],
    ["Customer balances", data.outstandingTrades ? currency(data.outstandingTrades.filter((row) => row.type === "SALE").reduce((sum, row) => sum + Number(row.balance ?? 0), 0)) : "Restricted"],
    ["Supplier balances", data.outstandingTrades ? currency(data.outstandingTrades.filter((row) => row.type === "PURCHASE").reduce((sum, row) => sum + Number(row.balance ?? 0), 0)) : "Restricted"],
  ] : [];

  let reportContent: ReactNode = null;
  if (data && activeTab === "overview") {
    reportContent = <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Purchase and sales value by {grouping}</CardTitle></CardHeader><CardContent><ReportTable rows={groupedTrades} columns={groupedColumns} /></CardContent></Card>
      </div>
      <p className="rounded-lg border border-[#e8ebef] bg-white px-4 py-3 text-xs leading-5 text-[#63707e]">{data.profitAvailability.explanation} {data.profitAvailability.method}</p>
    </>;
  } else if (data && activeTab === "trading") {
    reportContent = <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Purchased weight" value={weight(data.totals.purchasedKg)} />
        <Metric label="Purchase value" value={currency(data.totals.purchases)} />
        <Metric label="Sold weight" value={weight(data.totals.soldKg)} />
        <Metric label="Sales value" value={currency(data.totals.sales)} />
      </div>
      <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Volume and value by period</CardTitle>
        <select value={grouping} onChange={(event) => setGrouping(event.target.value as ReportGrouping)} className="h-9 rounded-lg border border-[#dfe4e9] bg-white px-3 text-xs">
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
        </select>
      </CardHeader><CardContent><ReportTable rows={groupedTrades} columns={groupedColumns} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Purchase and sales transactions</CardTitle></CardHeader><CardContent><ReportTable rows={data.trades} columns={tradeColumns} /></CardContent></Card>
    </>;
  } else if (data && activeTab === "inventory") {
    const karatColumns = makeColumns({ key: "karat", label: "Karat" }, { key: "kilograms", label: "Current stock", format: "kg" }, { key: "value", label: "Book value", format: "currency" });
    reportContent = <>
      <div className="grid gap-3 sm:grid-cols-2"><Metric label="Current stock" value={weight(data.totals.inventoryKg ?? 0)} /><Metric label="Inventory valuation (FIFO book value)" value={currency(data.totals.inventoryValue ?? 0)} /></div>
      <Card><CardHeader><CardTitle>Current stock by karat</CardTitle></CardHeader><CardContent><ReportTable rows={inventoryByKarat} columns={karatColumns} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Current stock by batch</CardTitle></CardHeader><CardContent><ReportTable rows={data.inventory ?? []} columns={inventoryColumns} /></CardContent></Card>
    </>;
  } else if (data && activeTab === "customers") {
    reportContent = <Card><CardHeader><CardTitle>Customer transaction history</CardTitle><p className="text-xs text-[#7c8793]">Transactions within the selected date range.</p></CardHeader><CardContent><ReportTable rows={data.trades} columns={tradeColumns} /></CardContent></Card>;
  } else if (data && (activeTab === "customer-advances" || activeTab === "buyer-financing")) {
    const customerAdvances = activeTab === "customer-advances";
    const type = customerAdvances ? "Customer gold advance" : "Buyer gold financing";
    const financingRows = (data.financing ?? []).filter((row) => row.type === type);
    const financingAccounts = (data.financingAccounts ?? []).filter((row) => row.type === type);
    const total = (activity: string) => financingRows
      .filter((row) => row.activity === activity)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const financingColumns = makeColumns(
      { key: "date", label: "Date", format: "date" },
      { key: "customer", label: "Customer" },
      { key: "accountReference", label: "Account" },
      { key: "activity", label: "Activity" },
      { key: "reference", label: "Reference" },
      { key: "relatedReference", label: "Linked trade" },
      { key: "amount", label: "Amount", format: "currency" },
    );
    const financingAccountColumns = makeColumns(
      { key: "customer", label: "Customer" },
      { key: "accountReference", label: "Account" },
      { key: "balance", label: "Current balance", format: "currency" },
      { key: "balanceMeaning", label: "Balance interpretation" },
      { key: "statement", label: "Statement" },
    );
    const dailySupplierColumns = makeColumns(
      { key: "date", label: "Date", format: "day" },
      { key: "stockKg", label: "Stock received", format: "kg" },
      { key: "sales", label: "Sales / purchase value", format: "currency" },
      { key: "balance", label: "Balance due", format: "currency" },
    );
    const dailyBuyerFinancingColumns = makeColumns(
      { key: "date", label: "Date", format: "day" },
      { key: "customer", label: "Customer" },
      { key: "stockKg", label: "Stock", format: "kg" },
      { key: "financing", label: "Financing", format: "currency" },
      { key: "balance", label: "Balance", format: "currency" },
    );
    reportContent = <>
      <Card className="financing-summary-print-root">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0 flex-1 text-left">
            <CardTitle>{customerAdvances ? "Daily supplier stock and balance" : "Daily customer gold financing summary"}</CardTitle>
            <p className="text-xs text-[#7c8793]">{customerAdvances
              ? "Supplier purchases within the selected period, with total outstanding purchase balances as of each date."
              : "Gold received against buyer financing, cash financing advanced, and the running amount owed as of each date."}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="report-controls shrink-0" onClick={printFinancingSummary}>
            <Printer size={14} /> Print summary
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          <div className="hidden print:block">
            <h3 className="text-lg font-semibold">Big Joe Gold — {customerAdvances ? "Daily Supplier Gold Advances Summary" : "Daily Customer Gold Financing Summary"}</h3>
            <p className="text-xs">Period: {new Date(data.period.from).toLocaleDateString("en-GH")} to {new Date(data.period.to).toLocaleDateString("en-GH")}</p>
          </div>
          <ReportTable
            rows={customerAdvances ? data.supplierDailySummary ?? [] : data.buyerFinancingDailySummary ?? []}
            columns={customerAdvances ? dailySupplierColumns : dailyBuyerFinancingColumns}
            emptyMessage={`No ${customerAdvances ? "supplier purchase" : "customer financing"} activity in this date range.`}
          />
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {customerAdvances ? <>
          <Metric label="Advance funds received" value={currency(total("Funds received"))} />
          <Metric label="Advance refunds" value={currency(total("Refund paid"))} />
          <Metric label="Gold released against advances" value={currency(total("Gold released"))} />
        </> : <>
          <Metric label="Cash advanced to buyers" value={currency(total("Cash advance paid"))} />
          <Metric label="Gold purchases settled" value={currency(total("Gold purchase settled"))} />
        </>}
      </div>
      <Card><CardHeader><CardTitle>Current balances by customer</CardTitle><p className="text-xs text-[#7c8793]">Balances are current as of report generation; activity below uses the selected date range. Generate a statement for full account history.</p></CardHeader><CardContent><ReportTable rows={financingAccounts} columns={financingAccountColumns} emptyMessage={`No ${customerAdvances ? "supplier gold advance" : "customer gold financing"} accounts found.`} onCustomerClick={openCustomer} onStatementClick={(customerId, customerName) => { void openStatement(customerId, customerName, customerAdvances ? "customer-advances" : "buyer-financing"); }} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Activity by customer</CardTitle><p className="text-xs text-[#7c8793]">Activity within the selected date range. Select a customer name to view their details.</p></CardHeader><CardContent><ReportTable rows={financingRows} columns={financingColumns} emptyMessage={`No ${customerAdvances ? "supplier gold advance" : "customer gold financing"} activity in this date range.`} onCustomerClick={openCustomer} /></CardContent></Card>
    </>;
  } else if (data && activeTab === "payments") {
    const outstandingColumns = makeColumns(
      { key: "type", label: "Transaction type" }, { key: "reference", label: "Reference" }, { key: "customer", label: "Customer / supplier" },
      { key: "amount", label: "Transaction value", format: "currency" }, { key: "balance", label: "Outstanding", format: "currency" },
    );
    reportContent = <>
      <Card><CardHeader><CardTitle>Payments recorded during this period</CardTitle></CardHeader><CardContent><ReportTable rows={data.payments ?? []} columns={paymentColumns} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Outstanding customer and supplier balances</CardTitle></CardHeader><CardContent><ReportTable rows={data.outstandingTrades ?? []} columns={outstandingColumns} /></CardContent></Card>
    </>;
  } else if (data && activeTab === "payment-methods") {
    const payments = data.payments ?? [];
    const accounts = data.paymentAccounts ?? [];
    const hasUnassignedPayments = payments.some((payment) => payment.accountId === null);
    const accountOptions = [
      ...accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, currency: account.currency })),
      ...(hasUnassignedPayments ? [{ id: UNASSIGNED_ACCOUNT, name: "Unassigned account", type: "—", currency: "GHS" }] : []),
    ];
    const accountId = accountOptions.some((account) => account.id === selectedPaymentAccountId)
      ? selectedPaymentAccountId
      : accountOptions[0]?.id ?? "";
    const accountTotals = accountOptions.map((account) => {
      const accountPayments = payments.filter((payment) =>
        account.id === UNASSIGNED_ACCOUNT ? payment.accountId === null : payment.accountId === account.id,
      );
      const received = accountPayments.filter((payment) => payment.direction === "INBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const paid = accountPayments.filter((payment) => payment.direction === "OUTBOUND")
        .reduce((sum, payment) => sum + payment.amount, 0);
      return {
        id: account.id,
        label: account.name,
        type: account.type,
        currency: account.currency,
        received,
        paid,
        net: received - paid,
        count: accountPayments.length,
      };
    });
    const selectedAccount = accountOptions.find((account) => account.id === accountId);
    const selectedPayments = payments.filter((payment) =>
      accountId === UNASSIGNED_ACCOUNT ? payment.accountId === null : payment.accountId === accountId,
    );
    const selectedTotal = accountTotals.find((item) => item.id === accountId);
    const summaryColumns = makeColumns(
      { key: "label", label: "Cash account" },
      { key: "type", label: "Account type" },
      { key: "currency", label: "Currency" },
      { key: "count", label: "Transactions" },
      { key: "received", label: "Money received", format: "currency" },
      { key: "paid", label: "Money paid", format: "currency" },
      { key: "net", label: "Net movement", format: "currency" },
    );
    const statementColumns = makeColumns(
      { key: "paidAt", label: "Date", format: "date" },
      { key: "reference", label: "Reference" },
      { key: "direction", label: "Direction" },
      { key: "method", label: "Payment method" },
      { key: "amount", label: "Amount", format: "currency" },
      { key: "customer", label: "Customer / supplier" },
      { key: "tradeReference", label: "Trade" },
      { key: "note", label: "Note" },
    );
    reportContent = <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Money received" value={currency(selectedTotal?.received ?? 0)} />
        <Metric label="Money paid" value={currency(selectedTotal?.paid ?? 0)} />
        <Metric label="Net movement" value={currency(selectedTotal?.net ?? 0)} />
        <Metric label="Transactions" value={String(selectedTotal?.count ?? 0)} />
      </div>
      <Card>
        <CardHeader><CardTitle>Totals by cash account</CardTitle><p className="text-xs text-[#7c8793]">Each account is reported separately for the selected date range. Net movement is money received minus money paid.</p></CardHeader>
        <CardContent><ReportTable rows={accountTotals} columns={summaryColumns} emptyMessage="No cash accounts are available for this report." /></CardContent>
      </Card>
      <Card className="account-statement-print-root">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{selectedAccount?.name ?? "Cash account"} statement</CardTitle>
            <p className="mt-1 text-xs text-[#7c8793]">Transactions from {new Date(data.period.from).toLocaleDateString("en-GH")} to {new Date(data.period.to).toLocaleDateString("en-GH")}</p>
          </div>
          <div className="report-controls flex flex-wrap items-center gap-2">
            <label htmlFor="cash-account-statement" className="sr-only">Cash account</label>
            <select id="cash-account-statement" value={accountId} onChange={(event) => setSelectedPaymentAccountId(event.target.value)} className="h-9 rounded-lg border border-[#dfe4e9] bg-white px-3 text-xs" disabled={!accountOptions.length}>
              {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <Button type="button" variant="gold" size="sm" onClick={() => window.print()} disabled={!selectedAccount}><Printer size={14} /> Print / Save PDF</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden print:block">
            <h3 className="text-lg font-semibold">Big Joe Gold — {selectedAccount?.name ?? "Cash account"} Statement</h3>
            <p className="text-xs">Period: {new Date(data.period.from).toLocaleDateString("en-GH")} to {new Date(data.period.to).toLocaleDateString("en-GH")}</p>
            <p className="text-xs">Account type: {selectedAccount?.type ?? "—"} · Currency: {selectedAccount?.currency ?? "GHS"}</p>
            <p className="text-xs">Money received: {currency(selectedTotal?.received ?? 0)} · Money paid: {currency(selectedTotal?.paid ?? 0)} · Net movement: {currency(selectedTotal?.net ?? 0)}</p>
          </div>
          <ReportTable rows={selectedPayments} columns={statementColumns} emptyMessage={`No payments recorded for ${selectedAccount?.name ?? "this account"} in this date range.`} />
        </CardContent>
      </Card>
    </>;
  } else if (data && activeTab === "cash-flow") {
    const cashColumns = makeColumns(
      { key: "movementDate", label: "Date", format: "date" }, { key: "reference", label: "Reference" }, { key: "account", label: "Account" },
      { key: "type", label: "Movement" }, { key: "direction", label: "Direction" }, { key: "amount", label: "Amount", format: "currency" },
      { key: "approvalStatus", label: "Approval" }, { key: "createdBy", label: "Recorded by" },
    );
    reportContent = <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Money received" value={currency(data.totals.cashIn)} />
        <Metric label="Money paid" value={currency(data.totals.cashOut)} />
        <Metric label="Net cash flow" value={currency(data.totals.netCashFlow)} />
      </div>
      <Card><CardHeader><CardTitle>Account cash movements</CardTitle></CardHeader><CardContent><ReportTable rows={data.cashMovements ?? []} columns={cashColumns} /></CardContent></Card>
    </>;
  } else if (data && activeTab === "movements") {
    const movementColumns = makeColumns(
      { key: "movementDate", label: "Date", format: "date" }, { key: "reference", label: "Reference" }, { key: "type", label: "Movement" },
      { key: "batchNumber", label: "Batch" }, { key: "quantityKg", label: "Quantity", format: "kg" }, { key: "location", label: "Location" },
      { key: "transfer", label: "Transfer" }, { key: "reason", label: "Reason" }, { key: "createdBy", label: "Recorded by" },
    );
    reportContent = <Card><CardHeader><CardTitle>Stock movement history</CardTitle></CardHeader><CardContent><ReportTable rows={data.stockMovements ?? []} columns={movementColumns} /></CardContent></Card>;
  } else if (data && activeTab === "staff") {
    const staffColumns = makeColumns({ key: "date", label: "Date", format: "date" }, { key: "staff", label: "Staff member" }, { key: "activity", label: "Activity" }, { key: "reference", label: "Record reference" });
    reportContent = <Card><CardHeader><CardTitle>Staff activity</CardTitle></CardHeader><CardContent><ReportTable rows={data.staffActivity ?? []} columns={staffColumns} /></CardContent></Card>;
  } else if (data && activeTab === "board") {
    const boardColumns = makeColumns(
      { key: "effectiveAt", label: "Effective date", format: "date" }, { key: "direction", label: "Direction" }, { key: "quotedRate", label: "Quoted rate" },
      { key: "source", label: "Source" }, { key: "note", label: "Note" }, { key: "createdBy", label: "Published by" },
    );
    reportContent = <Card><CardHeader><CardTitle>Board price history</CardTitle></CardHeader><CardContent><ReportTable rows={data.boardPrices ?? []} columns={boardColumns} /></CardContent></Card>;
  }

  const customerDetailFields: Array<[string, string]> = [
    ["Phone", "phone"],
    ["Alternative phone", "alternativePhone"],
    ["Email", "email"],
    ["Address", "address"],
    ["Address line 1", "addressLine1"],
    ["Address line 2", "addressLine2"],
    ["City / town", "city"],
    ["Region", "region"],
    ["Country", "country"],
    ["GPS location", "gpsLocation"],
    ["Date of birth", "dateOfBirth"],
    ["Gender", "gender"],
    ["ID type", "idType"],
    ["ID number", "idNumber"],
    ["TIN / identification reference", "tin"],
    ["Notes", "notes"],
  ];

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium text-[#8b949e]">Workspace / Reports</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">Reports</h1><p className="mt-1.5 text-sm text-[#76808c]">Database-backed gold trading, inventory, finance, and operations reports.</p></div>
      <div className="report-controls flex flex-wrap items-center gap-2">
        <RefreshButton loading={loading} onClick={() => void load()} />
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data}><Printer size={14} /> Save PDF</Button>
        <Button variant="gold" size="sm" onClick={exportExcel} disabled={!data}><Download size={14} /> Export Excel</Button>
      </div>
    </div>

    <Card className="report-controls">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end">
        <div className="grid gap-1">
          <label htmlFor="dashboard-from-date" className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8793]">From</label>
          <CalendarPicker id="dashboard-from-date" value={from} max={to} onChange={setFrom} className="!h-9 !pl-3 !pr-10 !text-xs font-normal normal-case tracking-normal" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="dashboard-to-date" className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8793]">To</label>
          <CalendarPicker id="dashboard-to-date" value={to} min={from} max={new Date().toISOString().slice(0, 10)} onChange={setTo} className="!h-9 !pl-3 !pr-10 !text-xs font-normal normal-case tracking-normal" />
        </div>
        <p className="pb-2 text-[11px] text-[#89929d]">Amounts in GHS; weights in kilograms and grams. Each report uses the selected transaction or movement dates.</p>
      </CardContent>
    </Card>

    <AlertDialog open={Boolean(error)} title="Reports error" description={error} onConfirm={() => setError("")} />
    {loading && <p className="text-sm text-[#7c8793]">Loading database reports…</p>}
    {!loading && !error && data && <div className="space-y-5">
      <nav aria-label="Report sections" className="report-controls overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1 whitespace-nowrap rounded-lg border border-[#e8ebef] bg-white px-3 py-2">
          {visibleTabs.map((tab, index) => <li key={tab.id} className="flex items-center gap-1">
            {index > 0 && <ChevronRight aria-hidden="true" size={13} className="text-[#b0b7bf]" />}
            <button
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-2 py-1 text-xs transition ${activeTab === tab.id ? "bg-[#f8e6b0] font-semibold text-[#17212f] ring-1 ring-[#d6aa42]" : "text-[#74808d] hover:bg-[#f7f8fa] hover:text-[#17212f]"}`}
            >
              {tab.label}
            </button>
          </li>)}
        </ol>
      </nav>
      <p className="text-[11px] text-[#89929d]">Report range: {date(data.period.from)} – {date(data.period.to)} · {data.totals.tradeCount} purchase/sale transactions</p>
      <div className="report-print-area space-y-5">
        <h2 className="hidden text-xl font-semibold text-[#17212f] print:block">Big Joe Gold — {tabs.find((tab) => tab.id === activeTab)?.label ?? "Reports"}</h2>
        {reportContent}
      </div>
    </div>}
    {customerModalOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCustomer(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="report-customer-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f5e3b0] text-[#795719]"><UserRound size={19} /></span>
            <div><h2 id="report-customer-title" className="text-lg font-semibold text-[#17212f]">{customerModalName}</h2>
              {customerDetail && <p className="mt-1 text-xs text-[#76808c]">{text(customerDetail.code)} · {customerDetail.kind === "SUPPLIER" ? "Customer" : "Supplier"} · {customerDetail.type === "BUSINESS" ? "Business" : "Individual"}</p>}
            </div>
          </div>
          <button type="button" onClick={closeCustomer} aria-label="Close customer details" className="rounded-md p-1.5 text-[#8c95a0] hover:bg-[#f1f3f5]"><X size={17} /></button>
        </div>
        {customerLoading && <p className="mt-6 text-sm text-[#7c8793]">Loading customer details…</p>}
        <AlertDialog open={Boolean(customerError)} title="Customer report error" description={customerError} onConfirm={() => setCustomerError("")} />
        {customerDetail && <>
          <div className="mt-5 rounded-lg bg-[#f7f8fa] px-3 py-2 text-xs text-[#63707e]">
            <span className={`mr-2 inline-block size-2 rounded-full ${customerDetail.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
            {customerDetail.isActive ? "Active" : "Archived"}
            {typeof customerDetail.createdAt === "string" ? ` · Added ${date(customerDetail.createdAt)}` : ""}
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {customerDetailFields.filter(([, key]) => customerDetail[key] !== undefined).map(([label, key]) => {
              const value = customerDetail[key];
              return <div key={key} className="min-w-0 rounded-lg border border-[#edf0f2] px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#89929d]">{label}</dt>
                <dd className="mt-1 break-words text-sm text-[#293442]">{key === "dateOfBirth" && typeof value === "string" ? new Date(value).toLocaleDateString("en-GH") : text(value)}</dd>
              </div>;
            })}
          </dl>
          {customerDetail.phone === undefined && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">Contact details and other personal information are restricted for your role.</p>}
        </>}
      </section>
    </div>}
    {statement && <div className="statement-print-root fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-[#0c1521]/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeStatement(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="financing-statement-title" className="statement-print-card max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-xl">
        <header className="statement-letterhead flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#bc8c36] pb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-xl bg-[#17212f] text-[#e2bd70]">
              <Gem size={27} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-black tracking-[.12em] text-[#17212f]">BIG JOE GOLD</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[.2em] text-[#8d641f]">Gold trading &amp; investment</p>
            </div>
          </div>
          <div className="text-right">
            <h2 id="financing-statement-title" className="text-lg font-semibold uppercase tracking-wide text-[#17212f]">{statement.type === "customer-advances" ? "Supplier Gold Advance" : "Customer Gold Financing"} Statement</h2>
            <p className="mt-1 text-xs text-[#637083]">Generated {new Date().toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p>
          </div>
        </header>
        <div className="statement-print-actions flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#17212f]">{statement.customerName}{statement.customerCode ? ` · ${statement.customerCode}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="gold" size="sm" onClick={() => window.print()} disabled={statementLoading}><Printer size={14} /> Print / Save PDF</Button>
            <Button type="button" variant="outline" size="sm" aria-label="Close statement" onClick={closeStatement}><X size={14} /> Close</Button>
          </div>
        </div>
        {statementLoading
          ? <p className="mt-6 text-sm text-[#7c8793]">Loading full financing history…</p>
          : statementError
            ? <AlertDialog open title="Financing statement error" description={statementError} onConfirm={() => setStatementError("")} />
            : <>
              <section className="mt-4 rounded-lg border border-[#e7ebef] bg-[#fafbfc] px-4 py-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[#89929d]">Customer</h3>
                <p className="mt-1 text-base font-semibold text-[#17212f]">{statement.customerName}</p>
                <p className="mt-1 text-sm text-[#495564]">Phone: {statement.phoneRestricted ? "Restricted" : statement.customerPhone ?? "Not on file"}</p>
                {statement.customerCode && <p className="mt-1 text-xs text-[#637083]">Customer code: {statement.customerCode}</p>}
              </section>
              <div className="mt-4 flex flex-wrap justify-between gap-2 border-y border-[#e7ebef] py-3 text-sm">
                <p>Current position: <strong>{statement.type === "customer-advances"
                  ? `${statement.balance >= 0 ? "Credit owed to customer" : "Amount customer owes"} ${currency(Math.abs(statement.balance))}`
                  : `${statement.balance > 0 ? "Customer owes Big Joe" : statement.balance < 0 ? "Big Joe owes customer" : "Settled"} ${currency(Math.abs(statement.balance))}`}</strong></p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead><tr className="border-b border-[#dfe4e9] text-[#637083]"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Activity</th><th className="py-2 pr-3">Reference</th><th className="py-2 pr-3">Details</th><th className="py-2 pr-3 text-right">{statement.type === "customer-advances" ? "Credit increase" : "Advance paid"}</th><th className="py-2 pr-3 text-right">{statement.type === "customer-advances" ? "Applied / refunded" : "Gold / cash received"}</th><th className="py-2 text-right">Balance</th></tr></thead>
                  <tbody>{statement.rows.map((row) => <tr key={row.id} className="border-b border-[#edf0f3] align-top"><td className="whitespace-nowrap py-2 pr-3">{date(row.date)}</td><td className="py-2 pr-3">{row.account}</td><td className="py-2 pr-3">{row.activity}</td><td className="py-2 pr-3">{row.reference}</td><td className="py-2 pr-3">{row.details || "—"}</td><td className="whitespace-nowrap py-2 pr-3 text-right">{row.increase ? currency(row.increase) : "—"}</td><td className="whitespace-nowrap py-2 pr-3 text-right">{row.decrease ? currency(row.decrease) : "—"}</td><td className="whitespace-nowrap py-2 text-right font-semibold">{currency(row.balance)}</td></tr>)}
                    {!statement.rows.length && <tr><td colSpan={8} className="py-6 text-center text-[#89929d]">No account activity to include in this statement.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-[#637083]">{statement.type === "customer-advances"
                ? "A positive balance is cash credit owed to the customer; a negative balance means the customer owes Big Joe Gold."
                : "A positive balance means the customer owes Big Joe; a negative balance means Big Joe owes the customer."}</p>
            </>}
      </section>
    </div>}
  </div>;
}
