"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateFilter } from "@/components/ui/date-filter";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { PaymentProcessingOverlay } from "@/components/ui/payment-processing-overlay";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { formatCurrency } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { useToast } from "@/components/ui/toast-provider";

export type FinanceView = "payments-received" | "payments-made" | "accounts" | "summaries" | "reconciliation";
type Row = Record<string, unknown>;
type FinanceAccount = { id: string; name: string; type: string; currency: string; balance?: string; isActive: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const localDateTime = (clockOffsetMs = 0) => {
  const date = new Date(Date.now() + clockOffsetMs);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const methods = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"];

function message(body: unknown, fallback: string) {
  if (!body || typeof body !== "object" || !("error" in body) || typeof body.error !== "string") return fallback;
  if (body.error === "Validation failed" && "fields" in body && body.fields && typeof body.fields === "object") {
    const details = Object.values(body.fields)
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter((value): value is string => typeof value === "string");
    if (details.length) return `${body.error}: ${details.join(". ")}`;
  }
  return body.error;
}

function statusText(value: unknown) {
  return String(value ?? "").replaceAll("_", " ");
}

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? formatCurrency(parsed) : "—";
}

export function FinanceManagement({
  view,
  canWrite,
  canManage,
  canApprove,
}: {
  view: FinanceView;
  canWrite: boolean;
  canManage: boolean;
  canApprove: boolean;
}) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<Row | null>(null);
  const [payments, setPayments] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [movements, setMovements] = useState<Row[]>([]);
  const [unreconciled, setUnreconciled] = useState<Row[]>([]);
  const [trades, setTrades] = useState<Row[]>([]);
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [paymentProcessingMessage, setPaymentProcessingMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const paymentDateEdited = useRef(false);
  const openingDateEdited = useRef(false);
  const movementDateEdited = useRef(false);
  const { success: showToast } = useToast();
  const [payment, setPayment] = useState({ target: "", amount: "", method: "CASH", cashAccountId: "", note: "", paidAt: localDateTime() });
  const [account, setAccount] = useState({ name: "", type: "CASH", currency: "GHS", institution: "", accountReference: "", openingBalance: "0", openingDate: localDateTime() });
  const [movement, setMovement] = useState({ action: "ADJUST", accountId: "", fromAccountId: "", toAccountId: "", direction: "INBOUND", amount: "", movementDate: localDateTime(), description: "" });
  const [settings, setSettings] = useState({ adjustmentApprovalThreshold: "" });
  const router = useRouter();

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const requests: Record<string, Promise<Response>> = {};
      if (view !== "payments-received" || canWrite) {
        requests.accounts = fetch(`/api/finance/accounts${view === "payments-received" ? "?options=true" : ""}`, { cache: "no-store" });
      }
      if (["summaries", "accounts", "reconciliation"].includes(view)) {
        requests.overview = fetch(`/api/finance?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T23:59:59.999`)}`, { cache: "no-store" });
        if (canManage) requests.settings = fetch("/api/finance/settings", { cache: "no-store" });
      }
      if (view === "payments-received" || view === "payments-made") {
        requests.payments = fetch("/api/payments", { cache: "no-store" });
        if (canWrite) requests.trades = fetch(`/api/trades?type=${view === "payments-received" ? "SALE" : "PURCHASE"}`, { cache: "no-store" });
      }
      if (view === "accounts") {
        requests.movements = fetch("/api/finance/movements", { cache: "no-store" });
      }
      if (view === "reconciliation") {
        requests.reconciliation = fetch("/api/finance/reconciliation", { cache: "no-store" });
        requests.movements = fetch("/api/finance/movements", { cache: "no-store" });
      }
      const entries = await Promise.all(Object.entries(requests).map(async ([key, request]) => {
        const response = await request;
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(message(body, `Unable to load ${key}`));
        return { key, body, serverTime: response.headers.get("x-server-time") };
      }));
      const data = Object.fromEntries(entries.map(({ key, body }) => [key, body])) as Record<string, unknown>;
      const serverTimeHeader = entries.find((entry) => entry.key === "accounts")?.serverTime;
      if (serverTimeHeader) {
        const serverTime = Date.parse(serverTimeHeader);
        if (Number.isFinite(serverTime)) {
          const offset = serverTime - Date.now();
          setServerClockOffsetMs(offset);
          if (!paymentDateEdited.current) setPayment((current) => ({ ...current, paidAt: localDateTime(offset) }));
          if (!openingDateEdited.current) setAccount((current) => ({ ...current, openingDate: localDateTime(offset) }));
          if (!movementDateEdited.current) setMovement((current) => ({ ...current, movementDate: localDateTime(offset) }));
        }
      }
      const availableAccounts = Array.isArray(data.accounts) ? data.accounts as FinanceAccount[] : [];
      setAccounts(availableAccounts);
      if (data.overview && typeof data.overview === "object") setSummary(data.overview as Row);
      if (Array.isArray(data.payments)) setPayments(data.payments as Row[]);
      if (Array.isArray(data.movements)) setMovements(data.movements as Row[]);
      if (Array.isArray(data.reconciliation)) setUnreconciled(data.reconciliation as Row[]);
      if (Array.isArray(data.trades)) setTrades(data.trades as Row[]);
      if (!background && data.settings && typeof data.settings === "object") setSettings(data.settings as typeof settings);
      setPayment((current) => ({
        ...current,
        cashAccountId: availableAccounts.some((item) => item.id === current.cashAccountId && item.isActive && item.currency === "GHS")
          ? current.cashAccountId
          : "",
      }));
      setMovement((current) => ({
        ...current,
        accountId: availableAccounts.some((item) => item.id === current.accountId && item.isActive) ? current.accountId : "",
        fromAccountId: availableAccounts.some((item) => item.id === current.fromAccountId && item.isActive) ? current.fromAccountId : "",
        toAccountId: availableAccounts.some((item) => item.id === current.toAccountId && item.isActive) ? current.toAccountId : "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load finance records");
    } finally {
      setLoading(false);
    }
  }, [canManage, canWrite, from, to, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(() => load(true));

  async function send(url: string, methodName: string, body: BodyInit, contentType = "application/json") {
    const response = await fetch(url, {
      method: methodName,
      headers: contentType === "application/json" ? { "Content-Type": contentType } : undefined,
      body,
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(message(result, "Unable to save finance record"));
    return result;
  }

  async function run(action: () => Promise<void>, success: string, processingMessage?: string) {
    setBusy(true);
    setError("");
    setPaymentProcessingMessage(processingMessage ?? null);
    try {
      await action();
      showToast(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save finance record");
    } finally {
      setBusy(false);
      setPaymentProcessingMessage(null);
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [, id] = payment.target.split(":");
    const target = trades.find((item) => item.id === id);
    const direction = target?.type === "PURCHASE" ? "OUTBOUND" : "INBOUND";
    setBusy(true);
    setError("");
    setPaymentProcessingMessage(direction === "INBOUND" ? "Generating receipt…" : "Recording payment…");
    let navigatingToReceipt = false;
    try {
      const result = await send("/api/payments", "POST", JSON.stringify({
        tradeId: id,
        direction,
        amount: payment.amount,
        method: payment.method,
        cashAccountId: payment.cashAccountId,
        paidAt: new Date(payment.paidAt).toISOString(),
        note: payment.note,
      }));
      const paymentId = result && typeof result === "object" && "id" in result && typeof result.id === "string"
        ? result.id
        : "";
      if (direction === "INBOUND" && !paymentId) {
        throw new Error("Payment was recorded, but its receipt could not be opened. Find it in payment history.");
      }
      setPayment((current) => ({ ...current, target: "", amount: "", note: "" }));
      showToast("Payment recorded and reconciled to the selected cash account.");
      if (paymentId && direction === "INBOUND") {
        navigatingToReceipt = true;
        router.push(`/finance/payments-received/receipt/${encodeURIComponent(paymentId)}`);
      } else {
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save finance record");
    } finally {
      if (!navigatingToReceipt) {
        setBusy(false);
        setPaymentProcessingMessage(null);
      }
    }
  }

  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await send("/api/finance/accounts", "POST", JSON.stringify({ ...account, openingDate: new Date(account.openingDate).toISOString() }));
      setAccount((current) => ({ ...current, name: "", institution: "", accountReference: "", openingBalance: "0" }));
    }, "Account created; its opening balance is recorded as a ledger movement.");
  }

  async function saveMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const payload = movement.action === "TRANSFER"
        ? {
          action: movement.action,
          fromAccountId: movement.fromAccountId,
          toAccountId: movement.toAccountId,
          amount: movement.amount,
          movementDate: new Date(movement.movementDate).toISOString(),
          description: movement.description,
        }
        : {
          action: movement.action,
          accountId: movement.accountId,
          direction: movement.direction,
          amount: movement.amount,
          movementDate: new Date(movement.movementDate).toISOString(),
          description: movement.description,
        };
      await send("/api/finance/movements", "POST", JSON.stringify(payload));
      setMovement((current) => ({ ...current, amount: "", description: "" }));
    }, "Account movement recorded. Large adjustments may require approval before affecting the balance.");
  }

  async function reconcile(paymentId: string, cashAccountId: string) {
    await run(async () => {
      await send("/api/finance/reconciliation", "POST", JSON.stringify({ paymentId, cashAccountId }));
    }, "Payment added to the selected account ledger and marked reconciled.");
  }

  async function decide(url: string, decision: "APPROVE" | "REJECT") {
    await run(async () => { await send(url, "POST", JSON.stringify({ decision })); },
      decision === "APPROVE" ? "Request approved." : "Request rejected.");
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => { await send("/api/finance/settings", "PUT", JSON.stringify(settings)); }, "Approval thresholds updated.");
  }

  const titles: Record<FinanceView, string> = {
    "payments-received": "Payments received",
    "payments-made": "Payments made",
    accounts: "Cash and bank accounts",
    summaries: "Financial summaries",
    reconciliation: "Transaction reconciliation",
  };
  const pageSummary = summary?.summary as Row | undefined;
  const activeAccounts = accounts.filter((item) => item.isActive && item.currency === "GHS");
  const paymentCandidates = [
    ...trades.filter((trade) => trade.status === "POSTED").map((trade) => {
      const direction = trade.type === "SALE" ? "INBOUND" : "OUTBOUND";
      const paid = nestedRows(trade, "payments")
        .filter((item) => item.direction === direction)
        .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
      const corrections = nestedRows(trade, "corrections");
      const credits = corrections.reduce((sum, item) => sum + Number(item.creditAmount ?? 0), 0);
      const refunds = corrections.reduce((sum, item) => sum + Number(item.refundAmount ?? 0), 0);
      const balance = Math.max(0, Number(trade.totalAmount ?? 0) - paid - (trade.type === "SALE" ? credits : 0) + (trade.type === "SALE" ? refunds : 0));
      return {
        kind: "trade",
        id: String(trade.id),
        balance: balance.toFixed(2),
        label: `${trade.reference} · ${trade.type} · ${text(nested(trade, "customer").name)} · Outstanding ${amount(balance)}`,
      };
    }),
  ].filter((item) => Number(item.balance) > 0);
  const availablePaymentCandidates = paymentCandidates.filter((item) =>
    view === "payments-received"
      ? trades.find((trade) => trade.id === item.id)?.type === "SALE"
      : trades.find((trade) => trade.id === item.id)?.type === "PURCHASE");

  return <>
  <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-[#8b949e]">Workspace / Finance</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{titles[view]}</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-[#76808c]">Track real account balances, trade payments, outstanding amounts, and auditable cash movements.</p>
      </div>
      <RefreshButton loading={loading} onClick={() => { void load(); }} />
    </div>

    <nav className="flex flex-wrap gap-2 text-xs">
      <NavLink href="/finance/payments-received" label="Payments received" pathname={pathname} />
      <NavLink href="/finance/payments-made" label="Payments made" pathname={pathname} />
      <NavLink href="/finance/accounts" label="Accounts" pathname={pathname} />
      <NavLink href="/finance/summaries" label="Summaries" pathname={pathname} />
      <NavLink href="/finance/reconciliation" label="Reconciliation" pathname={pathname} />
    </nav>
    <AlertDialog open={Boolean(error)} title="Finance error" description={error} onConfirm={() => setError("")} />
    {["summaries", "accounts", "reconciliation"].includes(view) && <DateFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={() => { void load(); }} busy={loading} />}

    {pageSummary && ["summaries", "accounts", "reconciliation"].includes(view) && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Income received" value={amount(pageSummary.incomeReceived)} />
      <Metric label="Money paid" value={amount(pageSummary.cashOut)} />
      <Metric label="Net cash flow" value={amount(pageSummary.netCashFlow)} />
      <Metric label="Customer balances due" value={amount(pageSummary.outstandingCustomerBalances)} />
      <Metric label="Supplier balances due" value={amount(pageSummary.outstandingSupplierBalances)} />
      <Metric label="Pending approvals" value={String(pageSummary.pendingApprovalCount ?? 0)} />
    </div>}

    {(view === "payments-received" || view === "payments-made") && <>
      {canWrite && <Card><CardHeader><CardTitle>{view === "payments-received" ? "Record customer receipt" : "Record supplier payment"}</CardTitle><p className="text-xs text-[#89929d]">Select an open trade. Payment and account ledger entries are committed atomically.</p></CardHeader><CardContent>
        <form onSubmit={savePayment} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FormField label="Outstanding transaction" htmlFor="finance-payment-target"><select id="finance-payment-target" required disabled={loading} value={payment.target} onChange={(event) => {
            const target = event.target.value;
            const selected = paymentCandidates.find((item) => `${item.kind}:${item.id}` === target);
            setPayment((current) => ({ ...current, target, amount: selected?.balance ?? "" }));
          }} className={fieldControlClass}><option value="">{loading ? "Loading customers with outstanding balances…" : availablePaymentCandidates.length ? "Select a transaction" : "No transactions with an outstanding balance"}</option>{availablePaymentCandidates.map((item) => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.label}</option>)}</select></FormField>
          <FormField label="Amount (GHS)" htmlFor="finance-payment-amount"><GhanaAmountInput id="finance-payment-amount" required min="0.01" step="0.01" readOnly={Boolean(payment.target)} value={payment.amount} onChange={(amount) => setPayment({ ...payment, amount })} className={`${fieldControlClass} ${payment.target ? "bg-[#f7f8fa]" : ""}`} /></FormField>
          <FormField label="Date and time" htmlFor="finance-payment-date"><CalendarPicker id="finance-payment-date" includeTime max={localDateTime(serverClockOffsetMs)} required value={payment.paidAt} onChange={(paidAt) => { paymentDateEdited.current = true; setPayment({ ...payment, paidAt }); }} /></FormField>
          <FormField label="Payment method" htmlFor="finance-payment-method"><select value={payment.method} id="finance-payment-method" onChange={(event) => setPayment({ ...payment, method: event.target.value })} className={fieldControlClass}>{methods.map((item) => <option key={item} value={item}>{statusText(item)}</option>)}</select></FormField>
          <FormField label="Cash / bank account" htmlFor="finance-payment-account"><select required value={payment.cashAccountId} id="finance-payment-account" onChange={(event) => setPayment({ ...payment, cashAccountId: event.target.value })} className={fieldControlClass}><option value="">Select account</option>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
          <FormField label="Reference or note" htmlFor="finance-payment-note"><input id="finance-payment-note" maxLength={500} value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} className={fieldControlClass} /></FormField>
          <div><Button type="submit" variant="gold" disabled={busy || loading}>Record payment</Button></div>
        </form>
      </CardContent></Card>}
      <PaymentsTable rows={payments.filter((item) => view === "payments-received" ? item.direction === "INBOUND" : item.direction === "OUTBOUND")} showReceipt={view === "payments-received"} />
    </>}

    {view === "accounts" && <>
      {canManage && <Card><CardHeader><CardTitle>Add cash, bank, or Mobile Money account</CardTitle><p className="text-xs text-[#89929d]">Balances are derived from approved ledger movements. Opening balances are recorded as opening movements.</p></CardHeader><CardContent>
        <form onSubmit={saveAccount} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Account name" htmlFor="cash-account-name"><input id="cash-account-name" required minLength={2} value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} className={fieldControlClass} /></FormField>
          <FormField label="Account type" htmlFor="cash-account-type"><select id="cash-account-type" value={account.type} onChange={(event) => setAccount({ ...account, type: event.target.value })} className={fieldControlClass}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile Money</option></select></FormField>
          <FormField label="Currency" htmlFor="cash-account-currency"><input id="cash-account-currency" required pattern="[A-Z]{3}" maxLength={3} value={account.currency} onChange={(event) => setAccount({ ...account, currency: event.target.value.toUpperCase() })} className={fieldControlClass} /></FormField>
          <FormField label="Institution / provider" htmlFor="cash-account-institution"><input id="cash-account-institution" value={account.institution} onChange={(event) => setAccount({ ...account, institution: event.target.value })} className={fieldControlClass} /></FormField>
          <FormField label="Account reference (optional)" htmlFor="cash-account-reference"><input id="cash-account-reference" value={account.accountReference} onChange={(event) => setAccount({ ...account, accountReference: event.target.value })} className={fieldControlClass} /></FormField>
          <FormField label="Opening balance" htmlFor="cash-account-opening"><GhanaAmountInput id="cash-account-opening" min="0" step="0.01" value={account.openingBalance} onChange={(openingBalance) => setAccount({ ...account, openingBalance })} className={fieldControlClass} /></FormField>
          <FormField label="Opening balance date" htmlFor="cash-account-date"><CalendarPicker id="cash-account-date" includeTime max={localDateTime(serverClockOffsetMs)} value={account.openingDate} onChange={(openingDate) => { openingDateEdited.current = true; setAccount({ ...account, openingDate }); }} /></FormField>
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy}>Create account</Button></div>
        </form>
      </CardContent></Card>}
      <Card><CardHeader><CardTitle>Account balances</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{accounts.map((item) => <div key={item.id} className="rounded-lg border border-[#e8ebef] p-4"><div className="flex justify-between gap-3"><strong className="text-sm text-[#293442]">{item.name}</strong><span className="text-[10px] uppercase text-[#89929d]">{statusText(item.type)} · {item.currency}</span></div><p className="mt-3 text-xl font-semibold text-[#17212f]">{accountAmount(item.balance, item.currency)}</p><p className="mt-1 text-[10px] text-[#89929d]">{item.isActive ? "Active account" : "Inactive account"}</p></div>)}</div>{!accounts.length && <p className="text-xs text-[#89929d]">No accounts configured yet.</p>}</CardContent></Card>
      {canManage && <Card><CardHeader><CardTitle>Transfer or adjust an account</CardTitle><p className="text-xs text-[#89929d]">Transfers create paired ledger entries. Large adjustments can be held for approval using the configured threshold.</p></CardHeader><CardContent>
        <form onSubmit={saveMovement} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Movement" htmlFor="finance-movement-action"><select id="finance-movement-action" value={movement.action} onChange={(event) => setMovement({ ...movement, action: event.target.value })} className={fieldControlClass}><option value="ADJUST">Account adjustment</option><option value="TRANSFER">Account transfer</option></select></FormField>
          {movement.action === "TRANSFER" ? <>
            <FormField label="From account" htmlFor="finance-transfer-from"><select required id="finance-transfer-from" value={movement.fromAccountId} onChange={(event) => setMovement({ ...movement, fromAccountId: event.target.value })} className={fieldControlClass}><option value="">Select account</option>{accounts.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} · {accountAmount(item.balance, item.currency)}</option>)}</select></FormField>
            <FormField label="To account" htmlFor="finance-transfer-to"><select required id="finance-transfer-to" value={movement.toAccountId} onChange={(event) => setMovement({ ...movement, toAccountId: event.target.value })} className={fieldControlClass}><option value="">Select account</option>{accounts.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</select></FormField>
          </> : <>
            <FormField label="Account" htmlFor="finance-adjust-account"><select required id="finance-adjust-account" value={movement.accountId} onChange={(event) => setMovement({ ...movement, accountId: event.target.value })} className={fieldControlClass}><option value="">Select account</option>{accounts.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
            <FormField label="Direction" htmlFor="finance-adjust-direction"><select id="finance-adjust-direction" value={movement.direction} onChange={(event) => setMovement({ ...movement, direction: event.target.value })} className={fieldControlClass}><option value="INBOUND">Increase</option><option value="OUTBOUND">Decrease</option></select></FormField>
          </>}
          <FormField label="Amount" htmlFor="finance-movement-amount"><GhanaAmountInput required min="0.01" step="0.01" id="finance-movement-amount" value={movement.amount} onChange={(amount) => setMovement({ ...movement, amount })} className={fieldControlClass} /></FormField>
          <FormField label="Date" htmlFor="finance-movement-date"><CalendarPicker id="finance-movement-date" includeTime max={localDateTime(serverClockOffsetMs)} required value={movement.movementDate} onChange={(movementDate) => { movementDateEdited.current = true; setMovement({ ...movement, movementDate }); }} /></FormField>
          <FormField label="Reason / reference" htmlFor="finance-movement-reason"><input required minLength={5} maxLength={500} id="finance-movement-reason" value={movement.description} onChange={(event) => setMovement({ ...movement, description: event.target.value })} className={fieldControlClass} /></FormField>
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy}>Post movement</Button></div>
        </form>
      </CardContent></Card>}
      {canManage && <SettingsForm settings={settings} setSettings={setSettings} save={saveSettings} busy={busy} />}
      <MovementTable rows={movements} canApprove={canApprove} busy={busy} decide={decide} />
    </>}

    {view === "summaries" && <>
      {pageSummary && <Card><CardHeader><CardTitle>Cash and bank account balances</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{((pageSummary.accounts as Row[] | undefined) ?? []).map((item) => <div key={text(item.id)} className="rounded-lg bg-[#f7f8fa] p-4"><p className="text-xs text-[#76808c]">{text(item.name)} · {statusText(item.type)}</p><p className="mt-2 text-lg font-semibold">{accountAmount(item.balance, text(item.currency))}</p></div>)}</div></CardContent></Card>}
      <OutstandingTable rows={summary?.outstanding as Row[] ?? []} />
    </>}

    {view === "reconciliation" && <>
      <Card><CardHeader><CardTitle>Payments not linked to the cash ledger</CardTitle><p className="text-xs text-[#89929d]">Historical payments without an account movement remain visible here until assigned. Reconciliation appends an auditable ledger entry.</p></CardHeader><CardContent><div className="space-y-3">{unreconciled.map((item) => { const trade = nested(item, "trade"); const reference = text(item.reference); return <div key={text(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e8ebef] p-3"><div><p className="text-xs font-semibold">{reference} · {statusText(item.direction)} · {amount(item.amount)}</p><p className="mt-1 text-[10px] text-[#89929d]">{text(trade.reference ?? "Unallocated")} · {new Date(text(item.paidAt)).toLocaleString()}</p></div>{canManage && <div className="flex gap-2"><select aria-label={`Account for ${reference}`} id={`reconcile-${text(item.id)}`} className={`${fieldControlClass} w-48`} defaultValue={text(item.cashAccountId)}><option value="">Choose account</option>{activeAccounts.map((cashAccount) => <option key={cashAccount.id} value={cashAccount.id}>{cashAccount.name}</option>)}</select><Button size="sm" disabled={busy} onClick={() => { const select = document.getElementById(`reconcile-${text(item.id)}`) as HTMLSelectElement | null; if (select?.value) void reconcile(text(item.id), select.value); }}>Reconcile</Button></div>}</div>; })}{!unreconciled.length && <p className="text-xs text-emerald-700">All listed payments are linked to the account ledger.</p>}</div></CardContent></Card>
      <MovementTable rows={movements} canApprove={canApprove} busy={busy} decide={decide} />
    </>}

    {loading && <p className="text-xs text-[#89929d]">Loading finance records…</p>}
  </div>
  <PaymentProcessingOverlay message={busy ? paymentProcessingMessage : null} />
  </>;
}

function NavLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-full border px-3 py-2 transition ${active ? "border-[#d6aa42] bg-[#f8e6b0] font-semibold text-[#17212f] shadow-sm" : "border-[#e8ebef] bg-white text-[#52606d] hover:border-[#bc8c36] hover:bg-[#fff8e6] hover:text-[#8b6726]"}`}>{label}</Link>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-[10px] font-medium text-[#85909b]">{label}</p><p className="mt-2 text-lg font-semibold tracking-tight text-[#17212f]">{value}</p></CardContent></Card>;
}

function PaymentsTable({ rows, showReceipt }: { rows: Row[]; showReceipt: boolean }) {
  return <Card><CardHeader><CardTitle>Payment history</CardTitle></CardHeader><CardContent><RowsTable
    headers={["Reference", "Direction", "Amount", "Method", "Account", "Allocated to", "Recorded by", "Date"]}
    rows={rows}
    actions={showReceipt ? (row) => <Button asChild size="sm" variant="outline"><Link href={`/finance/payments-received/receipt/${encodeURIComponent(text(row.id))}`}>Receipt</Link></Button> : undefined}
    values={(row) => {
      const account = nested(row, "cashAccount");
      const trade = nested(row, "trade");
      const customer = nested(row, "customer");
      const creator = nested(row, "createdBy");
      return [text(row.reference), statusText(row.direction), amount(row.amount), statusText(row.method), text(account.name ?? "Unassigned"), text(trade.reference ?? customer.name), text(creator.name), dateText(row.paidAt, true)];
    }}
  /></CardContent></Card>;
}

function MovementTable({ rows, canApprove, busy, decide }: { rows: Row[]; canApprove: boolean; busy: boolean; decide: (url: string, decision: "APPROVE" | "REJECT") => Promise<void> }) {
  return <Card><CardHeader><CardTitle>Cash ledger movements</CardTitle></CardHeader><CardContent><RowsTable
    headers={["Reference", "Movement", "Account", "Direction", "Amount", "Status", "Reason", "Date"]}
    rows={rows}
    values={(row) => [text(row.reference), statusText(row.type), text(nested(row, "account").name), statusText(row.direction), amount(row.amount), statusText(row.approvalStatus), text(row.description ?? nested(row, "payment").reference), dateText(row.movementDate, true)]}
    actions={(row) => canApprove && row.approvalStatus === "PENDING" ? <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => { void decide(`/api/finance/movements/${text(row.id)}/approval`, "APPROVE"); }}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { void decide(`/api/finance/movements/${text(row.id)}/approval`, "REJECT"); }}>Reject</Button></div> : null}
  /></CardContent></Card>;
}

function OutstandingTable({ rows }: { rows: Row[] }) {
  return <Card><CardHeader><CardTitle>Outstanding trade balances</CardTitle></CardHeader><CardContent><RowsTable
    headers={["Reference", "Type", "Customer / supplier", "Trade amount", "Balance due"]}
    rows={rows}
    values={(row) => [text(row.reference), statusText(row.type), text(row.customer), amount(row.amount), amount(row.balance)]}
  /></CardContent></Card>;
}

function SettingsForm({ settings, setSettings, save, busy }: { settings: { adjustmentApprovalThreshold: string }; setSettings: (value: { adjustmentApprovalThreshold: string }) => void; save: (event: React.FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <Card><CardHeader><CardTitle>Account adjustment approval threshold</CardTitle><p className="text-xs text-[#89929d]">Leave blank to disable approval for high-value account adjustments. Changes are audit logged.</p></CardHeader><CardContent><form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><FormField label="Adjustment threshold (GHS)" htmlFor="adjust-threshold"><input id="adjust-threshold" min="0" step="0.01" type="number" value={settings.adjustmentApprovalThreshold} onChange={(event) => setSettings({ adjustmentApprovalThreshold: event.target.value })} className={fieldControlClass} placeholder="Disabled" /></FormField><div className="flex items-end"><Button type="submit" variant="gold" disabled={busy}>Save approval setting</Button></div></form></CardContent></Card>;
}

function RowsTable({ headers, rows, values, actions }: { headers: string[]; rows: Row[]; values: (row: Row) => React.ReactNode[]; actions?: (row: Row) => React.ReactNode }) {
  const allHeaders = actions ? [...headers, ""] : headers;
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{allHeaders.map((header, index) => <th key={`${header}-${index}`} className="whitespace-nowrap border-b border-[#edf0f3] px-3 py-2 font-semibold text-[#89929d]">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={text(row.id ?? row.reference ?? index)} className="border-b border-[#f0f2f4] last:border-0">{values(row).map((value, cell) => <td key={cell} className="max-w-64 px-3 py-2.5 text-[#52606d]">{value ?? "—"}</td>)}{actions && <td className="px-3 py-2.5">{actions(row)}</td>}</tr>)}</tbody></table>{!rows.length && <p className="py-5 text-center text-xs text-[#89929d]">No records found.</p>}</div>;
}

function nested(row: Row, key: string): Row {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function nestedRows(row: Row, key: string): Row[] {
  const value = row[key];
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function dateText(value: unknown, includeTime = false) {
  const date = new Date(text(value));
  if (!Number.isFinite(date.getTime())) return "—";
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function accountAmount(value: unknown, currency: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "—";
  const truncated = Number(formatDecimalTruncated(numberValue, 2));
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency, maximumFractionDigits: 2 }).format(truncated);
  } catch {
    return `${currency} ${formatDecimalTruncated(numberValue, 2)}`;
  }
}
