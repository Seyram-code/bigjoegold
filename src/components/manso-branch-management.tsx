"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast-provider";
import { formatCurrency, formatTwoDecimalTruncated } from "@/lib/formatters";
import { calculateGoldMeasurements } from "@/lib/gold";
import type { PurchaseFormulaRules } from "@/lib/purchase-formula";

type MansoData = {
  account: { id: string; name: string; balance: string };
  availableBalance: string;
  accounts: Array<{ id: string; name: string; type: string }>;
  formula: PurchaseFormulaRules;
  movements: Array<{
    id: string;
    reference: string;
    type: string;
    direction: "INBOUND" | "OUTBOUND";
    amount: string;
    movementDate: string;
    runningBalance: string;
    description: string | null;
    approvalStatus: string;
    createdBy: { name: string };
    payment: { trade: {
      reference: string;
      quantityKg: string;
      totalAmount: string;
      purchaseMeasurement: { topKg: string; downKg: string; density: string; karat: string } | null;
    } | null } | null;
  }>;
};

type TransferAction = "ADVANCE" | "RETURN";

function localDateTime() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function displayDate(value: string) {
  return new Date(value).toLocaleString();
}

function normalizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const decimalIndex = cleaned.indexOf(".");
  return decimalIndex === -1
    ? cleaned
    : `${cleaned.slice(0, decimalIndex)}.${cleaned.slice(decimalIndex + 1).replaceAll(".", "")}`;
}

function formatAmountInput(value: string) {
  const [whole, fraction] = value.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? groupedWhole : `${groupedWhole}.${fraction}`;
}

function handleAmountInput(event: ChangeEvent<HTMLInputElement>, onChange: (value: string) => void) {
  const input = event.currentTarget;
  const cursor = input.selectionStart ?? input.value.length;
  const value = normalizeAmountInput(input.value);
  const nextCursor = formatAmountInput(normalizeAmountInput(input.value.slice(0, cursor))).length;
  onChange(value);
  requestAnimationFrame(() => input.setSelectionRange(nextCursor, nextCursor));
}

export function MansoBranchManagement({
  canManageFunds,
  canReceiveGold,
}: {
  canManageFunds: boolean;
  canReceiveGold: boolean;
}) {
  const [data, setData] = useState<MansoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { success: showToast } = useToast();
  const [fundsAction, setFundsAction] = useState<TransferAction>("ADVANCE");
  const [fundsForm, setFundsForm] = useState({
    cashAccountId: "",
    amount: "",
    movementDate: localDateTime(),
    description: "",
  });
  const [goldForm, setGoldForm] = useState({
    topGrams: "",
    downGrams: "",
    actualCost: "",
    transactionDate: localDateTime(),
    batchNumber: "",
    note: "",
  });
  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    movementDate: localDateTime(),
    description: "",
  });

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/manso-branch", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Unable to load Manso branch records";
        throw new Error(message);
      }
      const result = body as MansoData;
      setData(result);
      setFundsForm((current) => ({
        ...current,
        cashAccountId: result.accounts.some((account) => account.id === current.cashAccountId)
          ? current.cashAccountId
          : result.accounts[0]?.id ?? "",
      }));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Manso branch records");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const preview = useMemo(() => {
    if (!data || !goldForm.topGrams || !goldForm.downGrams) return null;
    try {
      const measurements = calculateGoldMeasurements(goldForm.topGrams, goldForm.downGrams, data.formula);
      return {
        density: measurements.density.toString(),
        karat: measurements.karat.toString(),
        pounds: measurements.pounds.toString(),
        purity: measurements.purity.toString(),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Check the entered weights" };
    }
  }, [data, goldForm.downGrams, goldForm.topGrams]);

  async function submit(event: FormEvent<HTMLFormElement>, payload: Record<string, string>, reset: () => void) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/manso-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Unable to save the Manso branch entry";
        throw new Error(message);
      }
      const result = body as { reference: string; batchNumber?: string; amount: string; measurements?: { karat: string } };
      showToast(`${payload.action === "RECEIVE_GOLD" ? "Gold receipt" : payload.action === "EXPENSE" ? "Branch expense" : payload.action === "ADVANCE" ? "Advance sent" : "Cash returned"} saved · ${result.reference}${result.batchNumber ? ` · Batch ${result.batchNumber}` : ""} · ${formatCurrency(Number(result.amount))}${result.measurements ? ` · ${Number(result.measurements.karat).toFixed(2)} kt` : ""}`);
      reset();
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the Manso branch entry");
    } finally {
      setBusy(false);
    }
  }

  const branchBalance = Number(data?.account.balance ?? 0);
  const availableBalance = Number(data?.availableBalance ?? 0);

  return <>
    <AlertDialog
      open={Boolean(error)}
      title="Manso branch error"
      description={error}
      onConfirm={() => setError("")}
    />
    <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-[#788391]">Workspace / Manso Branch</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#17212f]">Manso Branch</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#697584]">Track funds sent to the branch, gold bought at its actual cost, expenses, and unused cash returned. Gold measurements use the saved formula; the board price is not used to value branch purchases.</p>
      </div>
      <Button type="button" variant="outline" onClick={() => void load(true)} disabled={loading || refreshing}>
        <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh
      </Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Funds currently at Manso" value={formatCurrency(branchBalance)} />
      <Metric label="Branch account" value={data?.account.name ?? "Loading…"} />
      <Metric label="Recent ledger entries" value={String(data?.movements.length ?? 0)} />
    </div>

    {loading && !data ? <p className="py-8 text-center text-sm text-[#697584]">Loading Manso branch records…</p> : <>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {canManageFunds && <Card>
          <CardHeader><CardTitle>Send funds or return unused cash</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
              const action = fundsAction;
              void submit(event, {
                action,
                cashAccountId: fundsForm.cashAccountId,
                amount: fundsForm.amount,
                movementDate: new Date(fundsForm.movementDate).toISOString(),
                description: fundsForm.description,
              }, () => setFundsForm({ ...fundsForm, amount: "", description: "", movementDate: localDateTime() }));
            }}>
              <FormField label="Action" htmlFor="manso-funds-action">
                <select id="manso-funds-action" value={fundsAction} onChange={(event) => setFundsAction(event.target.value as TransferAction)} className={fieldControlClass}>
                  <option value="ADVANCE">Send advance to Manso</option>
                  <option value="RETURN">Return cash to company</option>
                </select>
              </FormField>
              <FormField label={fundsAction === "ADVANCE" ? "Pay from company account" : "Deposit into company account"} htmlFor="manso-funds-account">
                <select id="manso-funds-account" required value={fundsForm.cashAccountId} onChange={(event) => setFundsForm({ ...fundsForm, cashAccountId: event.target.value })} className={fieldControlClass}>
                  <option value="">Select a GHS account</option>
                  {data?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}
                </select>
              </FormField>
              <FormField label="Amount (GHS)" htmlFor="manso-funds-amount">
                <input id="manso-funds-amount" type="text" inputMode="decimal" required value={formatAmountInput(fundsForm.amount)} onChange={(event) => handleAmountInput(event, (amount) => setFundsForm((current) => ({ ...current, amount })))} className={fieldControlClass} />
              </FormField>
              <FormField label="Date" htmlFor="manso-funds-date">
                <CalendarPicker id="manso-funds-date" includeTime max={localDateTime()} required value={fundsForm.movementDate} onChange={(movementDate) => setFundsForm({ ...fundsForm, movementDate })} />
              </FormField>
              <FormField label="Reason / reference (optional)" htmlFor="manso-funds-description" className="sm:col-span-2">
                <input id="manso-funds-description" maxLength={500} value={fundsForm.description} onChange={(event) => setFundsForm({ ...fundsForm, description: event.target.value })} className={fieldControlClass} placeholder={fundsAction === "ADVANCE" ? "e.g. Weekly buying funds" : "e.g. Unused balance returned"} />
              </FormField>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy || !fundsForm.cashAccountId}>{busy ? "Saving…" : fundsAction === "ADVANCE" ? "Send advance" : "Record cash return"}</Button></div>
            </form>
          </CardContent>
        </Card>}

        {canReceiveGold && <Card>
          <CardHeader><CardTitle>Record gold bought by Manso</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
              void submit(event, {
                action: "RECEIVE_GOLD",
                topGrams: goldForm.topGrams,
                downGrams: goldForm.downGrams,
                actualCost: normalizeAmountInput(goldForm.actualCost),
                transactionDate: new Date(goldForm.transactionDate).toISOString(),
                batchNumber: goldForm.batchNumber,
                note: goldForm.note,
              }, () => setGoldForm({ topGrams: "", downGrams: "", actualCost: "", transactionDate: localDateTime(), batchNumber: "", note: "" }));
            }}>
              <Card className="rounded-[10px] sm:col-span-2">
                <CardHeader className="px-3 pb-2 pt-2.5"><CardTitle className="text-[13px]">Gold measurement</CardTitle></CardHeader>
                <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                  <FormField label="Top weight (g)" htmlFor="manso-top-weight" hint="Enter the top weight in grams.">
                    <input id="manso-top-weight" type="number" min="0.00001" step="0.00001" max="999999.99999999" required value={goldForm.topGrams} onChange={(event) => setGoldForm({ ...goldForm, topGrams: event.target.value })} className={fieldControlClass} />
                  </FormField>
                  <FormField label="Down weight (g)" htmlFor="manso-down-weight" hint="Enter the down weight in grams.">
                    <input id="manso-down-weight" type="number" min="0.00001" step="0.00001" max="999999.99999999" required value={goldForm.downGrams} onChange={(event) => setGoldForm({ ...goldForm, downGrams: event.target.value })} className={fieldControlClass} aria-invalid={Boolean(preview && "error" in preview)} aria-describedby={preview && "error" in preview ? "manso-measurement-error" : undefined} />
                    {preview && "error" in preview && <p id="manso-measurement-error" role="alert" className="mt-1 text-[10px] leading-4 text-rose-700">{preview.error}</p>}
                  </FormField>
                  <FormField label="Pounds (auto)" htmlFor="manso-pounds">
                    <input id="manso-pounds" value={preview && !("error" in preview) ? formatTwoDecimalTruncated(preview.pounds) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
                  </FormField>
                  <FormField label="Density (auto)" htmlFor="manso-density">
                    <input id="manso-density" value={preview && !("error" in preview) ? formatTwoDecimalTruncated(preview.density) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
                  </FormField>
                  <FormField label="Karat (auto)" htmlFor="manso-karat">
                    <input id="manso-karat" value={preview && !("error" in preview) ? formatTwoDecimalTruncated(preview.karat) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
                  </FormField>
                  <FormField label="Purity (auto)" htmlFor="manso-purity">
                    <input id="manso-purity" value={preview && !("error" in preview) ? `${formatTwoDecimalTruncated(preview.purity)}%` : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
                  </FormField>
                </CardContent>
              </Card>
              <FormField label="Actual amount Manso paid (GHS)" htmlFor="manso-actual-cost" hint={`Available branch funds: ${formatCurrency(availableBalance)}. This actual cost—not the board price—will value the stock.`}>
                <input id="manso-actual-cost" type="text" inputMode="decimal" required value={formatAmountInput(goldForm.actualCost)} onChange={(event) => handleAmountInput(event, (actualCost) => setGoldForm((current) => ({ ...current, actualCost })))} className={fieldControlClass} />
              </FormField>
              <FormField label="Date received" htmlFor="manso-gold-date">
                <CalendarPicker id="manso-gold-date" includeTime max={localDateTime()} required value={goldForm.transactionDate} onChange={(transactionDate) => setGoldForm({ ...goldForm, transactionDate })} />
              </FormField>
              <FormField label="Batch number (optional)" htmlFor="manso-batch-number">
                <input id="manso-batch-number" maxLength={120} value={goldForm.batchNumber} onChange={(event) => setGoldForm({ ...goldForm, batchNumber: event.target.value })} className={fieldControlClass} placeholder="Auto-generate if blank" />
              </FormField>
              <FormField label="Note (optional)" htmlFor="manso-gold-note">
                <input id="manso-gold-note" maxLength={500} value={goldForm.note} onChange={(event) => setGoldForm({ ...goldForm, note: event.target.value })} className={fieldControlClass} placeholder="Receipt or purchase details" />
              </FormField>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy || !data?.formula.ownerConfirmed}>{busy ? "Saving…" : "Record gold and add to stock"}</Button>
                {data && !data.formula.ownerConfirmed && <p className="mt-2 text-xs text-amber-700">An authorized administrator must confirm the saved purchase formula before gold can be recorded.</p>}
              </div>
            </form>
          </CardContent>
        </Card>}

        {canManageFunds && <Card>
          <CardHeader><CardTitle>Record branch expense</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
              void submit(event, {
                action: "EXPENSE",
                amount: normalizeAmountInput(expenseForm.amount),
                movementDate: new Date(expenseForm.movementDate).toISOString(),
                description: expenseForm.description,
              }, () => setExpenseForm({ amount: "", movementDate: localDateTime(), description: "" }));
            }}>
              <FormField label="Amount (GHS)" htmlFor="manso-expense-amount">
                <input id="manso-expense-amount" type="text" inputMode="decimal" required value={formatAmountInput(expenseForm.amount)} onChange={(event) => handleAmountInput(event, (amount) => setExpenseForm((current) => ({ ...current, amount })))} className={fieldControlClass} />
              </FormField>
              <FormField label="Date" htmlFor="manso-expense-date">
                <CalendarPicker id="manso-expense-date" includeTime max={localDateTime()} required value={expenseForm.movementDate} onChange={(movementDate) => setExpenseForm({ ...expenseForm, movementDate })} />
              </FormField>
              <FormField label="Expense details" htmlFor="manso-expense-description" className="sm:col-span-2">
                <input id="manso-expense-description" required minLength={3} maxLength={500} value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} className={fieldControlClass} placeholder="Describe the branch expense and keep its receipt" />
              </FormField>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record expense"}</Button></div>
            </form>
          </CardContent>
        </Card>}
      </div>

      <Card>
        <CardHeader><CardTitle>Manso branch account activity</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead><tr className="border-b border-[#e8ebef] text-[#788391]"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Activity</th><th className="px-3 py-2">Details</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Recorded by</th></tr></thead>
              <tbody>
                {data?.movements.map((movement) => {
                  const trade = movement.payment?.trade;
                  const label = trade ? "Gold purchase" : movement.type === "TRANSFER_IN" ? "Advance received"
                    : movement.type === "TRANSFER_OUT" ? "Cash returned" : "Branch expense";
                  const measurement = trade?.purchaseMeasurement;
                  const details = trade
                    ? `${trade.reference} · ${Number(trade.quantityKg).toLocaleString()} kg · actual cost ${formatCurrency(Number(trade.totalAmount))}${measurement ? ` · ${Number(measurement.karat).toFixed(2)} kt` : ""}`
                    : movement.description ?? "—";
                  return <tr key={movement.id} className="border-b border-[#f0f2f4] last:border-0">
                    <td className="whitespace-nowrap px-3 py-3">{displayDate(movement.movementDate)}</td>
                    <td className="px-3 py-3 font-medium">{movement.reference}</td>
                    <td className="px-3 py-3">{label}</td>
                    <td className="max-w-[360px] truncate px-3 py-3" title={details}>{details}</td>
                    <td className="px-3 py-3">{movement.approvalStatus === "PENDING" ? "Pending approval" : movement.approvalStatus}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${movement.direction === "INBOUND" ? "text-emerald-700" : "text-[#263241]"}`}>{movement.direction === "INBOUND" ? "+" : "−"}{formatCurrency(Number(movement.amount))}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{formatCurrency(Number(movement.runningBalance))}</td>
                    <td className="px-3 py-3">{movement.createdBy.name}</td>
                  </tr>;
                })}
                {!data?.movements.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-[#788391]">No branch account activity yet. Send the first advance to Manso to begin tracking.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>}
    </div>
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent><p className="pt-4 text-xs font-medium text-[#788391]">{label}</p><p className="mt-2 break-words text-xl font-bold text-[#17212f]">{value}</p></CardContent></Card>;
}
