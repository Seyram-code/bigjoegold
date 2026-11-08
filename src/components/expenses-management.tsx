"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, fieldControlClass } from "@/components/ui/form-field";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useToast } from "@/components/ui/toast-provider";
import { formatCurrency } from "@/lib/formatters";
import { expenseCategories } from "@/lib/validation";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type ExpenseCategory = (typeof expenseCategories)[number];
type Expense = {
  id: string;
  reference: string;
  movementDate: string;
  expenseCategory: ExpenseCategory | null;
  account: { name: string };
  amount: number | string;
  approvalStatus: string;
  description: string | null;
  createdBy: { name: string } | null;
};
type Account = { id: string; name: string; type: string };
const categoryLabels: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  UTILITIES: "Utilities",
  SALARIES: "Salaries",
  TRANSPORT: "Transport",
  OFFICE_SUPPLIES: "Office supplies",
  MAINTENANCE: "Maintenance",
  COMMUNICATION: "Communication",
  BANK_CHARGES: "Bank charges",
  SECURITY: "Security",
  ASSAY: "Assay",
  OTHER: "Other",
};

function localDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function message(body: unknown, fallback: string) {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error
    : fallback;
}

export function ExpensesManagement({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState({ accountId: "", category: "TRANSPORT", amount: "", movementDate: localDateTime(), description: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(message(body, "Unable to load expenses"));
      if (!body || typeof body !== "object" || !("accounts" in body) || !("expenses" in body)
        || !Array.isArray(body.accounts) || !Array.isArray(body.expenses)) {
        throw new Error("The expenses service returned an invalid response");
      }
      const availableAccounts = body.accounts as Account[];
      setAccounts(availableAccounts);
      setExpenses(body.expenses as Expense[]);
      setForm((current) => ({
        ...current,
        accountId: availableAccounts.some((account) => account.id === current.accountId)
          ? current.accountId
          : availableAccounts[0]?.id ?? "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load expenses");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);
  useAutoRefresh(() => load(true));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amount: form.amount.replaceAll(",", ""),
          movementDate: new Date(form.movementDate).toISOString(),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(message(body, "Unable to record expense"));
      showToast("Expense recorded.");
      setForm((current) => ({ ...current, amount: "", description: "", movementDate: localDateTime() }));
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record expense");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/movements/${encodeURIComponent(id)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(message(body, "Unable to update expense approval"));
      showToast(decision === "APPROVE" ? "Expense approved." : "Expense rejected.");
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update expense approval");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-medium text-[#8b949e]">Workspace / Finance</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">Expenses</h1>
        <p className="mt-1.5 text-sm text-[#76808c]">Record operating costs and review their approval status. Only approved expenses reduce net profit.</p>
      </div>
      <RefreshButton loading={loading} onClick={() => void load()} />
    </div>

    <Card>
      <CardHeader><CardTitle>Expense date range</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <FormField label="From" htmlFor="expenses-from">
          <CalendarPicker id="expenses-from" value={from} max={to} onChange={setFrom} />
        </FormField>
        <FormField label="To" htmlFor="expenses-to">
          <CalendarPicker id="expenses-to" value={to} min={from} max={today} onChange={setTo} />
        </FormField>
      </CardContent>
    </Card>

    {canManage && <Card>
      <CardHeader><CardTitle>Record an expense</CardTitle><p className="text-xs text-[#7c8793]">High-value expenses use the existing finance approval threshold. Pending expenses do not affect profit or available balances until approved.</p></CardHeader>
      <CardContent>
        <form onSubmit={(event) => { void submit(event); }} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FormField label="Cash or bank account" htmlFor="expense-account">
            <select id="expense-account" required value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} className={fieldControlClass}>
              <option value="">Select an account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.type.replaceAll("_", " ")})</option>)}
            </select>
          </FormField>
          <FormField label="Category" htmlFor="expense-category">
            <select id="expense-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={fieldControlClass}>
              {expenseCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
            </select>
          </FormField>
          <FormField label="Amount (GHS)" htmlFor="expense-amount">
            <GhanaAmountInput id="expense-amount" required value={form.amount} onChange={(amount) => setForm({ ...form, amount })} className={fieldControlClass} />
          </FormField>
          <FormField label="Expense date" htmlFor="expense-date">
            <CalendarPicker id="expense-date" includeTime max={localDateTime()} required value={form.movementDate} onChange={(movementDate) => setForm({ ...form, movementDate })} />
          </FormField>
          <FormField label="Details" htmlFor="expense-description" className="sm:col-span-2">
            <input id="expense-description" required minLength={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={fieldControlClass} placeholder="Describe the expense; explain Other categories" />
          </FormField>
          <div className="sm:col-span-2 xl:col-span-3"><Button type="submit" disabled={busy || loading || !accounts.length}>{busy ? "Saving…" : "Record expense"}</Button></div>
        </form>
        {!accounts.length && !loading && <p className="mt-3 text-xs text-amber-700">Add an active GHS cash, bank, or Mobile Money account before recording expenses.</p>}
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle>Expense transactions</CardTitle><p className="text-xs text-[#7c8793]">Pending and rejected expenses remain visible for audit. They are excluded from net profit until approved.</p></CardHeader>
      <CardContent>
        {loading ? <p className="py-6 text-center text-sm text-[#7c8793]">Loading expenses…</p> : <div className="overflow-x-auto rounded-lg border border-[#e8ebef]">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-[#f7f8fa] text-[10px] uppercase tracking-wide text-[#7c8793]">
              <tr>{["Date", "Reference", "Category", "Account", "Amount", "Status", "Details", "Recorded by", "Review"].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2] bg-white">
              {expenses.map((expense) => <tr key={expense.id} className="text-[#495564]">
                <td className="whitespace-nowrap px-4 py-3">{new Date(expense.movementDate).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="whitespace-nowrap px-4 py-3">{expense.reference}</td>
                <td className="whitespace-nowrap px-4 py-3">{expense.expenseCategory ? categoryLabels[expense.expenseCategory] : "Other"}</td>
                <td className="whitespace-nowrap px-4 py-3">{expense.account.name}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatCurrency(expense.amount)}</td>
                <td className="whitespace-nowrap px-4 py-3">{expense.approvalStatus}</td>
                <td className="max-w-[240px] truncate px-4 py-3" title={expense.description ?? ""}>{expense.description || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">{expense.createdBy?.name || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">{canApprove && expense.approvalStatus === "PENDING" ? <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => { void decide(expense.id, "APPROVE"); }}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { void decide(expense.id, "REJECT"); }}>Reject</Button>
                </div> : "—"}</td>
              </tr>)}
              {!expenses.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#89929d]">No expenses in this date range.</td></tr>}
            </tbody>
          </table>
        </div>}
      </CardContent>
    </Card>
    <AlertDialog open={Boolean(error)} title="Expenses error" description={error} onConfirm={() => setError("")} />
  </div>;
}
