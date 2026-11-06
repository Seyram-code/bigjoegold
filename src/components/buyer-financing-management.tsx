"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Coins, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { PaymentProcessingOverlay } from "@/components/ui/payment-processing-overlay";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { formatCurrency } from "@/lib/formatters";
import { fetchAllCustomers } from "@/lib/customer-client";

type Customer = { id: string; name: string; code: string };
type CashAccount = { id: string; name: string; currency: string; isActive: boolean };
type Settlement = {
  id: string;
  reference: string;
  amount: string | number;
  createdAt: string;
  trade: { id: string; reference: string; quantityKg: string | number; purityBps: number; totalAmount: string | number; transactionDate: string; customer: { name: string; code: string } | null };
};
type AdvancePayment = { id: string; reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; method: string; paidAt: string; note: string | null; cashAccount: { name: string } | null };
type FinanceAccount = {
  id: string;
  reference: string;
  note: string | null;
  createdAt: string;
  balance: string | number;
  advanceAmount: string | number;
  goldAmount: string | number;
  customer: Customer;
  payments: AdvancePayment[];
  settlements: Settlement[];
};

const methods = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"] as const;
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

function balanceLabel(balance: string | number) {
  const value = Number(balance);
  if (value > 0) return { label: "Customer owes Big Joe", amount: formatCurrency(value), tone: "gold" as const };
  if (value < 0) return { label: "Big Joe owes customer", amount: formatCurrency(Math.abs(value)), tone: "blue" as const };
  return { label: "Settled", amount: formatCurrency(0), tone: "green" as const };
}

export function BuyerFinancingManagement({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [method, setMethod] = useState<(typeof methods)[number]>("CASH");
  const [paidAt, setPaidAt] = useState(localDateTime);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [financeResponse, cashResponse, nextCustomers] = await Promise.all([
        fetch("/api/buyer-financing", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetchAllCustomers<Customer>("BUYER"),
      ]);
      const [financeBody, cashBody] = await Promise.all([financeResponse.json(), cashResponse.json()]);
      if (!financeResponse.ok) throw new Error(messageFrom(financeBody, "Unable to load buyer financing accounts"));
      if (!cashResponse.ok) throw new Error(messageFrom(cashBody, "Unable to load cash accounts"));
      const nextAccounts = (financeBody as { accounts?: FinanceAccount[] }).accounts ?? [];
      const nextCashAccounts = Array.isArray(cashBody)
        ? (cashBody as CashAccount[]).filter((account) => account.isActive && account.currency === "GHS")
        : [];
      setAccounts(nextAccounts);
      setCustomers(nextCustomers);
      setCashAccounts(nextCashAccounts);
      setCustomerId((current) => current || nextCustomers[0]?.id || "");
      setSelectedAccountId((current) => nextAccounts.some((account) => account.id === current) ? current : nextAccounts[0]?.id || "");
      setCashAccountId((current) => nextCashAccounts.some((account) => account.id === current) ? current : nextCashAccounts[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load buyer financing accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(action: "CREATE_ADVANCE" | "ADD_ADVANCE") {
    setError("");
    if (!cashAccountId) {
      setError("Create or select an active GHS cash or bank account first.");
      return;
    }
    if (action === "CREATE_ADVANCE" && !customerId) {
      setError("Select the buyer receiving the advance.");
      return;
    }
    if (action === "ADD_ADVANCE" && !selectedAccountId) {
      setError("Select a buyer financing account.");
      return;
    }
    setBusy(true);
    setPaymentProcessing(true);
    try {
      const response = await fetch("/api/buyer-financing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "CREATE_ADVANCE" ? { customerId } : { accountId: selectedAccountId }),
          amount,
          cashAccountId,
          method,
          paidAt: new Date(paidAt).toISOString(),
          note,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to record the cash advance"));
      if (!body || typeof body !== "object" || !("paymentId" in body) || typeof body.paymentId !== "string") {
        throw new Error("The cash advance was saved, but its receipt could not be opened. Find the transaction in buyer financing history.");
      }
      setAmount("");
      setNote("");
      setGeneratingReceipt(true);
      router.push(`/finance/financing/receipt/${encodeURIComponent(body.paymentId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record the cash advance");
    } finally {
      setBusy(false);
      setPaymentProcessing(false);
    }
  }

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);

  return <>
  <div className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#17212f]">Customer Gold Financing</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#637083]">Record cash given to a buyer before they bring gold. When you receive their gold, apply the buyer&apos;s financing account in Receive Stock to settle it at the calculated purchase value.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={14} /> Refresh</Button>
    </div>
    <AlertDialog open={Boolean(error)} title="Buyer financing error" description={error} onConfirm={() => setError("")} />

    {canWrite && <Card>
      <CardHeader><CardTitle>Record cash advanced to a buyer</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label="Action" htmlFor="buyer-finance-action">
          <select id="buyer-finance-action" value={selectedAccountId ? "ADD_ADVANCE" : "CREATE_ADVANCE"} onChange={(event) => {
            if (event.target.value === "CREATE_ADVANCE") setSelectedAccountId("");
            else setSelectedAccountId(accounts[0]?.id ?? "");
          }} className={fieldControlClass}>
            <option value="CREATE_ADVANCE">Start new financing account</option>
            <option value="ADD_ADVANCE" disabled={!accounts.length}>Add advance to an existing account</option>
          </select>
        </FormField>
        {selectedAccountId
          ? <FormField label="Financing account" htmlFor="buyer-finance-account"><select id="buyer-finance-account" value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} className={fieldControlClass}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.customer.name} · {balanceLabel(account.balance).label} {balanceLabel(account.balance).amount}</option>)}</select></FormField>
          : <FormField label="Buyer" htmlFor="buyer-finance-customer"><CustomerAutocomplete id="buyer-finance-customer" customers={customers} value={customerId} onChange={setCustomerId} placeholder="Search buyers by name or ID" /></FormField>}
        <FormField label="Amount advanced (GHS)" htmlFor="buyer-finance-amount"><GhanaAmountInput id="buyer-finance-amount" min="0.01" step="0.01" value={amount} onChange={setAmount} className={fieldControlClass} /></FormField>
        <FormField label="Cash / bank account" htmlFor="buyer-finance-cash-account"><select id="buyer-finance-cash-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)} className={fieldControlClass}><option value="">Select an account</option>{cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></FormField>
        <FormField label="Payment method" htmlFor="buyer-finance-method"><select id="buyer-finance-method" value={method} onChange={(event) => setMethod(event.target.value as (typeof methods)[number])} className={fieldControlClass}>{methods.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></FormField>
        <FormField label="Date paid" htmlFor="buyer-finance-date"><CalendarPicker id="buyer-finance-date" includeTime max={localDateTime()} value={paidAt} onChange={setPaidAt} /></FormField>
        <FormField label="Note" htmlFor="buyer-finance-note"><input id="buyer-finance-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={fieldControlClass} /></FormField>
        <div className="flex items-end"><Button variant="gold" disabled={busy || loading || !amount || !cashAccountId || (!selectedAccountId && !customerId)} onClick={() => { void submit(selectedAccountId ? "ADD_ADVANCE" : "CREATE_ADVANCE"); }}><Coins size={15} />{busy ? "Saving…" : "Record cash advance"}</Button></div>
      </CardContent>
    </Card>}

    {selectedAccount && <Card>
      <CardHeader><CardTitle>{selectedAccount.customer.name} · Account {selectedAccount.reference}</CardTitle></CardHeader>
      <CardContent>
        {(() => {
          const balance = balanceLabel(selectedAccount.balance);
          return <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#e7ebef] p-3"><p className="text-xs text-[#637083]">Cash advanced</p><p className="mt-1 font-semibold">{formatCurrency(selectedAccount.advanceAmount)}</p></div>
            <div className="rounded-lg border border-[#e7ebef] p-3"><p className="text-xs text-[#637083]">Gold received and applied</p><p className="mt-1 font-semibold">{formatCurrency(selectedAccount.goldAmount)}</p></div>
            <div className="rounded-lg border border-[#e7ebef] p-3"><p className="text-xs text-[#637083]">{balance.label}</p><p className="mt-1 font-semibold">{balance.amount}</p></div>
          </div>;
        })()}
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle>Buyer financing accounts</CardTitle></CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-[#637083]">Loading accounts…</p> : accounts.length === 0
          ? <p className="text-sm text-[#637083]">No buyer financing accounts recorded.</p>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead><tr className="border-b text-xs text-[#637083]"><th className="py-2 pr-3">Buyer</th><th className="py-2 pr-3">Cash advanced</th><th className="py-2 pr-3">Gold applied</th><th className="py-2 pr-3">Current position</th><th className="py-2 pr-3">Activity</th></tr></thead>
              <tbody>{accounts.map((account) => {
                const balance = balanceLabel(account.balance);
                const activity = [
                  ...account.payments.map((payment) => ({ id: payment.reference, date: payment.paidAt, label: "Cash advanced", reference: payment.reference, amount: payment.amount, href: `/finance/financing/receipt/${encodeURIComponent(payment.id)}`, icon: <ArrowUpRight size={13} /> })),
                  ...account.settlements.map((settlement) => ({ id: settlement.reference, date: settlement.createdAt, label: `Gold purchase ${settlement.trade.reference}`, reference: settlement.reference, amount: settlement.amount, href: `/receive-stock/receipt/${encodeURIComponent(settlement.trade.id)}`, icon: <ArrowDownLeft size={13} /> })),
                ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                return <tr key={account.id} className="border-b align-top last:border-0">
                  <td className="py-3 pr-3"><button type="button" className="font-semibold text-[#17212f] hover:underline" onClick={() => setSelectedAccountId(account.id)}>{account.customer.name}</button><p className="text-xs text-[#637083]">{account.reference}</p></td>
                  <td className="py-3 pr-3">{formatCurrency(account.advanceAmount)}</td>
                  <td className="py-3 pr-3">{formatCurrency(account.goldAmount)}</td>
                  <td className="py-3 pr-3"><Badge tone={balance.tone}>{balance.label}: {balance.amount}</Badge></td>
                  <td className="py-3 pr-3"><details><summary className="cursor-pointer text-xs text-[#465362]">{activity.length} records</summary><ul className="mt-2 space-y-2 text-xs">{activity.map((item) => <li key={item.id} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1">{item.icon}{item.label} · {new Date(item.date).toLocaleDateString("en-GH")}</span><span className="flex items-center gap-2"><span className="font-medium">{formatCurrency(item.amount)}</span><Button asChild size="sm" variant="outline"><Link href={item.href}>Receipt</Link></Button></span></li>)}</ul></details></td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </CardContent>
    </Card>
  </div>
  <PaymentProcessingOverlay message={generatingReceipt ? "Opening receipt…" : paymentProcessing ? "Recording payment…" : null} />
  </>;
}
