"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { useToast } from "@/components/ui/toast-provider";
import { formatCurrency } from "@/lib/formatters";
import { buildManualMomoAccountSummaries, type ManualMomoStatementEntry } from "@/lib/manual-momo";

type Direction = "INBOUND" | "OUTBOUND";
type AccountType = "BANK" | "MOBILE_MONEY";
type Account = {
  id: string;
  name: string;
  type: AccountType;
  bankNameTelco: string;
  accountNumber: string | null;
  openingBalance: number;
  openingDate: string;
  balanceBeforePeriod: number;
};
type Entry = {
  id: string;
  accountId: string;
  createdBy: string;
} & ManualMomoStatementEntry;
type LedgerData = { accounts: Account[]; entries: Entry[] };
type Contact = { id: string; name: string; phone: string | null };

const today = new Date().toISOString().slice(0, 10);
const fieldLabelClass = "mb-1.5 block text-xs font-medium text-[#576170]";
const dateInputClass = "h-10 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm text-[#17212f]";

function toApiDate(value: string) {
  return `${value}T12:00:00.000Z`;
}

function displayDate(value: string) {
  return new Date(value).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" });
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Request failed (${response.status})`;
}

export function ManualMomo({ canWrite }: { canWrite: boolean }) {
  const [statementAccountId, setStatementAccountId] = useState("ALL");
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<LedgerData | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingAccount, setSavingAccount] = useState<string | null>(null);
  const [savingNewAccount, setSavingNewAccount] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();
  const [entryForm, setEntryForm] = useState({
    accountId: "",
    direction: "INBOUND" as Direction,
    customerName: "",
    customerPhone: "",
    amount: "",
    transactionReference: "",
    transactionDate: today,
    note: "",
  });
  const [newAccountForm, setNewAccountForm] = useState({
    type: "BANK" as AccountType,
    name: "",
    bankNameTelco: "",
    accountNumber: "",
    openingBalance: "",
  });
  const [openingForms, setOpeningForms] = useState<Record<string, { openingBalance: string }>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [response, contactsResponse] = await Promise.all([
        fetch(`/api/manual-momo?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" }),
        fetch("/api/manual-momo/contacts", { cache: "no-store" }),
      ]);
      if (!response.ok) throw new Error(await responseError(response));
      if (!contactsResponse.ok) throw new Error(await responseError(contactsResponse));
      const [result, contactResult] = await Promise.all([
        response.json() as Promise<LedgerData>,
        contactsResponse.json() as Promise<Contact[]>,
      ]);
      setData(result);
      setContacts(contactResult);
      setEntryForm((current) => ({
        ...current,
        accountId: result.accounts.some((account) => account.id === current.accountId)
          ? current.accountId
          : result.accounts[0]?.id ?? "",
      }));
      setOpeningForms(Object.fromEntries(result.accounts.map((account) => [
        account.id,
        { openingBalance: account.openingBalance.toFixed(2) },
      ])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Manual Bank & MOMO records.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void loadData(); }, [loadData]);

  const accountSummaries = useMemo(
    () => data ? buildManualMomoAccountSummaries(data.accounts, data.entries, from, to) : [],
    [data, from, to],
  );
  const visibleAccountSummaries = useMemo(
    () => statementAccountId === "ALL"
      ? accountSummaries
      : accountSummaries.filter(({ account }) => account.id === statementAccountId),
    [accountSummaries, statementAccountId],
  );
  const allAccountRows = useMemo(
    () => accountSummaries.flatMap(({ account, rows }) => rows.map((row, index) => ({
      ...row,
      accountId: account.id,
      accountName: account.name,
      accountType: account.type,
      rowKey: `${account.id}-${index}`,
    }))).sort((left, right) => left.date.localeCompare(right.date) || left.accountName.localeCompare(right.accountName)),
    [accountSummaries],
  );
  const visibleAccountRows = useMemo(
    () => statementAccountId === "ALL"
      ? allAccountRows
      : allAccountRows.filter((row) => row.accountId === statementAccountId),
    [allAccountRows, statementAccountId],
  );
  const selectedStatementAccount = data?.accounts.find((account) => account.id === statementAccountId);
  const accountSummaryRows = visibleAccountSummaries.map(({ account, opening, received, paid, closing }) => (
    <tr key={account.id} className="border-b border-[#edf0f3]">
      <td className="px-2 py-2.5 font-medium">{account.name}</td><td className="px-2 py-2.5">{account.type === "BANK" ? "Bank" : "Mobile Money"}</td><td className="px-2 py-2.5">{account.bankNameTelco}</td><td className="px-2 py-2.5">{account.accountNumber || "—"}</td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(opening)}</td><td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(received)}</td><td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(paid)}</td><td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">{formatCurrency(closing)}</td>
    </tr>
  ));
  const accountTransactionRows = visibleAccountRows.map((row) => (
    <tr key={row.rowKey} className={`border-b border-[#edf0f3]${row.direction === "OPENING BALANCE" ? " font-semibold" : ""}`}>
      <td className="px-2 py-2.5 font-semibold">{row.accountName}</td><td className="px-2 py-2.5">{row.accountType === "BANK" ? "Bank" : "Mobile Money"}</td>
      <td className="whitespace-nowrap px-2 py-2.5">{displayDate(row.date)}</td><td className="px-2 py-2.5">{row.reference}</td>
      <td className="whitespace-nowrap px-2 py-2.5">{row.direction === "RECEIVED" ? <span className="inline-flex items-center gap-1 text-emerald-700"><ArrowDownLeft size={13} /> Received</span> : row.direction === "PAID" ? <span className="inline-flex items-center gap-1 text-rose-700"><ArrowUpRight size={13} /> Paid</span> : row.direction}</td>
      <td className="px-2 py-2.5">{row.customer}</td><td className="px-2 py-2.5">{row.phone}</td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(row.amount)}</td><td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(row.balance)}</td><td className="px-2 py-2.5">{row.note}</td>
    </tr>
  ));
  const emptyTransactionRow = !visibleAccountRows.length && (
    <tr><td colSpan={10} className="px-2 py-8 text-center text-sm text-[#7c8793]">{visibleAccountSummaries.length ? "No manual payments recorded during this period." : "Create a ledger to start a statement."}</td></tr>
  );

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingEntry(true);
    setError("");
    try {
      const response = await fetch("/api/manual-momo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...entryForm,
          transactionDate: toApiDate(entryForm.transactionDate),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      showToast("Manual Bank & MOMO payment recorded. It has not changed the system's payment transactions.");
      setEntryForm((current) => ({ ...current, customerName: "", customerPhone: "", amount: "", transactionReference: "", note: "" }));
      setSelectedContactId("");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to record the Manual Bank & MOMO payment.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function saveOpeningBalance(account: Account) {
    setSavingAccount(account.id);
    setError("");
    try {
      const form = openingForms[account.id];
      const response = await fetch("/api/manual-momo/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          openingBalance: form.openingBalance || "0",
          openingDate: account.openingDate,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      showToast(`${account.name} opening balance saved.`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the opening balance.");
    } finally {
      setSavingAccount(null);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNewAccount(true);
    setError("");
    try {
      const response = await fetch("/api/manual-momo/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newAccountForm,
          openingBalance: newAccountForm.openingBalance || "0",
          openingDate: toApiDate(today),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const account = await response.json() as Account;
      setEntryForm((current) => ({ ...current, accountId: account.id }));
      setNewAccountForm({ type: "BANK", name: "", bankNameTelco: "", accountNumber: "", openingBalance: "" });
      showToast(`${account.name} ledger created.`);
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the Manual Bank & MOMO ledger.");
    } finally {
      setSavingNewAccount(false);
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-[#17212f]">Manual Bank &amp; MOMO</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#78818d]">Create separate bank and mobile money ledgers for customer payments. These independent records do not create or change system transactions.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild type="button" variant="outline"><Link href="/manual-momo/contacts">Manage contacts</Link></Button>
        <Button type="button" variant="outline" onClick={() => void loadData()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</Button>
      </div>
    </div>

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
    {canWrite && <Card>
      <CardHeader><CardTitle>Create an account ledger</CardTitle><p className="text-xs text-[#7c8793]">Set the account type, bank or telco, account details, and starting balance.</p></CardHeader>
      <CardContent><form onSubmit={createAccount} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label><span className={fieldLabelClass}>Account type</span><select value={newAccountForm.type} onChange={(event) => setNewAccountForm((current) => ({ ...current, type: event.target.value as AccountType }))} className={dateInputClass}>
          <option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile Money</option>
        </select></label>
        <label><span className={fieldLabelClass}>Account name</span><input required minLength={2} maxLength={120} value={newAccountForm.name} onChange={(event) => setNewAccountForm((current) => ({ ...current, name: event.target.value }))} className={dateInputClass} /></label>
        <label><span className={fieldLabelClass}>Bank Name/Telco</span><input required minLength={2} maxLength={120} value={newAccountForm.bankNameTelco} onChange={(event) => setNewAccountForm((current) => ({ ...current, bankNameTelco: event.target.value }))} className={dateInputClass} /></label>
        <label><span className={fieldLabelClass}>{newAccountForm.type === "BANK" ? "Account number" : "MOMO number"}</span><input required maxLength={120} value={newAccountForm.accountNumber} onChange={(event) => setNewAccountForm((current) => ({ ...current, accountNumber: event.target.value }))} className={dateInputClass} /></label>
        <label><span className={fieldLabelClass}>Opening balance (GHS)</span><GhanaAmountInput min="0" step="0.01" value={newAccountForm.openingBalance} onChange={(openingBalance) => setNewAccountForm((current) => ({ ...current, openingBalance }))} className={dateInputClass} /></label>
        <div className="flex items-end"><Button type="submit" variant="gold" disabled={savingNewAccount || loading}>{savingNewAccount ? "Creating…" : "Create ledger"}</Button></div>
      </form></CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle>Your Manual Bank &amp; MOMO ledgers</CardTitle><p className="text-xs text-[#7c8793]">Opening balances are maintained separately for each account.</p></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {data?.accounts.map((account) => <div key={account.id} className="rounded-xl border border-[#e7eaee] p-3">
          <h2 className="mb-1 text-sm font-semibold text-[#17212f]">{account.name}</h2>
          <p className="mb-3 text-xs text-[#7c8793]">{account.type === "BANK" ? "Bank" : "Mobile Money"} · {account.bankNameTelco || "No bank/telco name"} · {account.accountNumber || "No account number"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={fieldLabelClass}>Opening balance (GHS)</span><GhanaAmountInput min="0" step="0.01" value={openingForms[account.id]?.openingBalance ?? "0"} onChange={(openingBalance) => setOpeningForms((current) => ({ ...current, [account.id]: { openingBalance } }))} className={dateInputClass} disabled={!canWrite || loading} /></label>
          </div>
          {canWrite && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void saveOpeningBalance(account)} disabled={savingAccount !== null || loading}>{savingAccount === account.id ? "Saving…" : "Save opening balance"}</Button>}
        </div>)}
        {!loading && !data?.accounts.length && <p className="py-4 text-sm text-[#7c8793]">No ledgers yet. Create one above to begin recording manual account payments.</p>}
      </CardContent>
    </Card>

    {canWrite && <Card>
      <CardHeader><CardTitle>Record customer payment</CardTitle><p className="text-xs text-[#7c8793]">Received means money paid by a customer to you; paid means money you sent to a customer.</p></CardHeader>
      <CardContent>
        <form onSubmit={submitEntry} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className={fieldLabelClass}>Ledger</span><select required value={entryForm.accountId} onChange={(event) => setEntryForm((current) => ({ ...current, accountId: event.target.value }))} className={dateInputClass} disabled={!data?.accounts.length}>
            {data?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></label>
          <label><span className={fieldLabelClass}>Payment direction</span><select value={entryForm.direction} onChange={(event) => setEntryForm((current) => ({ ...current, direction: event.target.value as Direction }))} className={dateInputClass}>
            <option value="INBOUND">Received from customer</option><option value="OUTBOUND">Paid to customer</option>
          </select></label>
          <label><span className={fieldLabelClass}>Saved contact (optional)</span><select value={selectedContactId} onChange={(event) => {
            const contact = contacts.find((item) => item.id === event.target.value);
            setSelectedContactId(event.target.value);
            if (contact) setEntryForm((current) => ({ ...current, customerName: contact.name, customerPhone: contact.phone ?? "" }));
          }} className={dateInputClass}>
            <option value="">Enter contact manually</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.phone ? ` · ${contact.phone}` : ""}</option>)}
          </select></label>
          <label><span className={fieldLabelClass}>Customer name</span><input required minLength={2} maxLength={120} value={entryForm.customerName} onChange={(event) => setEntryForm((current) => ({ ...current, customerName: event.target.value }))} className={dateInputClass} /></label>
          <label><span className={fieldLabelClass}>Customer phone (optional)</span><input maxLength={40} value={entryForm.customerPhone} onChange={(event) => setEntryForm((current) => ({ ...current, customerPhone: event.target.value }))} className={dateInputClass} /></label>
          <label><span className={fieldLabelClass}>Amount (GHS)</span><GhanaAmountInput required min="0.01" step="0.01" value={entryForm.amount} onChange={(amount) => setEntryForm((current) => ({ ...current, amount }))} className={dateInputClass} /></label>
          <label><span className={fieldLabelClass}>Payment date</span><CalendarPicker id="manual-momo-payment-date" max={today} required value={entryForm.transactionDate} onChange={(transactionDate) => setEntryForm((current) => ({ ...current, transactionDate }))} /></label>
          <label><span className={fieldLabelClass}>External reference (optional)</span><input maxLength={191} value={entryForm.transactionReference} onChange={(event) => setEntryForm((current) => ({ ...current, transactionReference: event.target.value }))} className={dateInputClass} /></label>
          <label><span className={fieldLabelClass}>Note (optional)</span><input maxLength={500} value={entryForm.note} onChange={(event) => setEntryForm((current) => ({ ...current, note: event.target.value }))} className={dateInputClass} /></label>
          <div className="flex items-end lg:col-span-4"><Button type="submit" variant="gold" disabled={savingEntry || loading || !data?.accounts.length}>{savingEntry ? "Recording…" : "Record payment"}</Button></div>
        </form>
      </CardContent>
    </Card>}

    <div className="manual-momo-print-root">
    <Card>
      <CardHeader className="flex flex-wrap items-end justify-between gap-3">
        <div className="manual-momo-screen-title">
          <CardTitle>{selectedStatementAccount ? `${selectedStatementAccount.name} statement` : "Daily account close summary"}</CardTitle>
          <p className="mt-1 text-xs text-[#7c8793]">{selectedStatementAccount ? "Transactions and running balance for this account" : "Opening balances, payments received and made, and closing balances for all accounts"} from {from === to ? displayDate(`${from}T00:00:00.000Z`) : `${displayDate(`${from}T00:00:00.000Z`)} to ${displayDate(`${to}T00:00:00.000Z`)}`}.</p>
        </div>
        <div className="manual-momo-controls flex flex-wrap items-end gap-2">
          <label><span className={fieldLabelClass}>Account</span><select value={statementAccountId} onChange={(event) => {
            setStatementAccountId(event.target.value);
            if (event.target.value === "ALL") setShowAllTransactions(false);
          }} className={dateInputClass} disabled={!data?.accounts.length}>
            <option value="ALL">All accounts</option>
            {data?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></label>
          <label><span className={fieldLabelClass}>From</span><CalendarPicker id="manual-momo-statement-from" value={from} max={to} onChange={setFrom} /></label>
          <label><span className={fieldLabelClass}>To</span><CalendarPicker id="manual-momo-statement-to" value={to} min={from} max={today} onChange={setTo} /></label>
          <Button type="button" variant="gold" onClick={() => window.print()} disabled={loading || !data?.accounts.length}><Printer size={15} /> Print / Save PDF</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="hidden print:block">
          <h2 className="text-lg font-semibold">Big Joe Gold — {selectedStatementAccount ? `${selectedStatementAccount.name} Account Statement` : "Manual Bank & MOMO Daily Account Close"}</h2>
          <p className="text-xs">Period: {displayDate(`${from}T00:00:00.000Z`)} to {displayDate(`${to}T00:00:00.000Z`)}</p>
        </div>
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-[#17212f]">{selectedStatementAccount ? "Account closing balance" : "All account closing balances"}</h2>
          <div className="overflow-x-auto">
            <table className="manual-momo-account-summary-table w-full min-w-[720px] text-left text-xs">
              <thead><tr className="border-b border-[#e7eaee] text-[10px] uppercase tracking-wide text-[#7c8793]">
                <th className="px-2 py-2">Account</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Bank / Telco</th><th className="px-2 py-2">Account number</th><th className="px-2 py-2 text-right">Opening</th><th className="px-2 py-2 text-right">Received</th><th className="px-2 py-2 text-right">Paid</th><th className="px-2 py-2 text-right">Closing</th>
              </tr></thead>
              <tbody>{accountSummaryRows}</tbody>
            </table>
          </div>
        </section>
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#17212f]">{selectedStatementAccount ? `${selectedStatementAccount.name} transactions` : "All account transactions"}</h2>
            {!selectedStatementAccount && <Button
              type="button"
              variant="outline"
              size="sm"
              className="manual-momo-transaction-toggle"
              aria-expanded={showAllTransactions}
              aria-controls="manual-momo-all-transactions"
              onClick={() => setShowAllTransactions((current) => !current)}
            >
              {showAllTransactions ? "Hide all Transactions" : "View all Transactions"}
            </Button>}
          </div>
          <div id="manual-momo-all-transactions" hidden={!selectedStatementAccount && !showAllTransactions} className={`manual-momo-all-transactions overflow-x-auto${selectedStatementAccount ? " manual-momo-single-account-transactions" : ""}`}>
            <table className="manual-momo-transactions-table w-full min-w-[1120px] text-left text-xs">
              <thead><tr className="border-b border-[#e7eaee] text-[10px] uppercase tracking-wide text-[#7c8793]">
                <th className="px-2 py-2">Account</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Reference</th><th className="px-2 py-2">Direction</th><th className="px-2 py-2">Customer</th><th className="px-2 py-2">Phone</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 text-right">Balance</th><th className="px-2 py-2">Note</th>
              </tr></thead>
              <tbody>{accountTransactionRows}{emptyTransactionRow}</tbody>
            </table>
          </div>
        </section>
        {loading && <p className="py-4 text-center text-sm text-[#7c8793]">Loading Manual Bank &amp; MOMO records…</p>}
        {!loading && !accountSummaries.length && <p className="py-4 text-sm text-[#7c8793]">No account ledgers yet. Create one above to begin.</p>}
      </CardContent>
    </Card>
    </div>
  </div>;
}
