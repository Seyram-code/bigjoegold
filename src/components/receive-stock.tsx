"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { Check, FileText, LoaderCircle, MapPin, Plus, Printer, Save, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { GhanaDateInput } from "@/components/ui/ghana-date-input";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { useToast } from "@/components/ui/toast-provider";
import { calculatePurchaseMeasurements } from "@/lib/gold";
import { formatCurrency, formatCurrencyExact, formatCurrencyWholeGhsTruncated, formatTwoDecimalTruncated } from "@/lib/formatters";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { DEFAULT_PURCHASE_FORMULA_RULES, type PurchaseFormulaRules } from "@/lib/purchase-formula";
import { customerSchema } from "@/lib/validation";

type Customer = {
  id: string;
  code: string;
  name: string;
  type?: string;
  phone?: string | null;
  alternativePhone?: string | null;
  email?: string | null;
  address?: string | null;
};

type BoardPrice = {
  id: string;
  priceType: "RECEIVING" | "SELLING";
  priceAmount: string | number;
  currency: string;
  priceUnit: string;
  source: string;
  effectiveAt: string;
};
type CashAccount = { id: string; name: string; type: string; currency: string };
type FinancingAccount = { id: string; reference: string; balance: string | number; customer: { id: string; name: string; code: string; isActive: boolean } };

type ReceivingRecord = {
  id: string;
  reference: string;
  status: "DRAFT" | "POSTED" | "VOIDED";
  customerId: string | null;
  customer: { id: string; code: string; name: string } | null;
  transactionDate: string;
  inventoryBatchNumber: string | null;
  storageLocationName: string | null;
  topGrams: string | number | null;
  downGrams: string | number | null;
  pounds: string | number | null;
  density: string | number | null;
  karat: string | number | null;
  totalAmount: string | number;
  paymentAmount: string | number;
  paymentMethod: string;
  pricePerGram: string | number;
  priceUnit: string;
  boardPriceId: string | null;
  note: string | null;
  supportingDocumentRef: string | null;
  createdBy: { name: string };
  buyerFinanceSettlement?: { reference: string; amount: string | number; account: { reference: string; customer: { name: string; code: string } } } | null;
};

type FormValues = {
  customerId: string;
  transactionDate: string;
  batchNumber: string;
  storageLocation: string;
  topGrams: string;
  downGrams: string;
  boardPriceId: string;
  amountPaid: string;
  cashAccountId: string;
  paymentMethod: string;
  note: string;
  supportingDocumentRef: string;
};

type QuickCustomer = {
  name: string;
  type: "INDIVIDUAL" | "BUSINESS";
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: "" | "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
  idType: "" | "GHANA_CARD" | "PASSPORT" | "DRIVERS_LICENSE" | "VOTER_ID" | "OTHER";
  idNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  country: string;
  gpsLocation: string;
  notes: string;
};

const paymentMethods = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"];
const ghanaRegions = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra",
  "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West",
  "Volta", "Western", "Western North",
];
const emptyQuickCustomer = (): QuickCustomer => ({
  name: "",
  type: "INDIVIDUAL",
  phone: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  idType: "",
  idNumber: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  country: "Ghana",
  gpsLocation: "",
  notes: "",
});
const localDateTime = (value = new Date()) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
};
const emptyForm = (): FormValues => ({
  customerId: "",
  transactionDate: localDateTime(),
  batchNumber: "",
  storageLocation: "Main storage",
  topGrams: "",
  downGrams: "",
  boardPriceId: "",
  amountPaid: "0",
  cashAccountId: "",
  paymentMethod: "CASH",
  note: "",
  supportingDocumentRef: "",
});

function responseMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
}

export function ReceiveStock({ canWrite, canCreateCustomer, canReadPersonal, canUseBuyerFinancing, recordedBy }: {
  canWrite: boolean;
  canCreateCustomer: boolean;
  canReadPersonal: boolean;
  canUseBuyerFinancing: boolean;
  recordedBy: string;
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [prices, setPrices] = useState<BoardPrice[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [financingAccounts, setFinancingAccounts] = useState<FinancingAccount[]>([]);
  const [financingAccountId, setFinancingAccountId] = useState("");
  const [records, setRecords] = useState<ReceivingRecord[]>([]);
  const [formulaRules, setFormulaRules] = useState<PurchaseFormulaRules>(DEFAULT_PURCHASE_FORMULA_RULES);
  const [formulaRulesLoaded, setFormulaRulesLoaded] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [amountPaidTouched, setAmountPaidTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<ReceivingRecord | null>(null);
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [customerRequiredAlertOpen, setCustomerRequiredAlertOpen] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState<QuickCustomer>(emptyQuickCustomer);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState("");
  const { success: showToast } = useToast();

  useEffect(() => {
    if (!quickCustomerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setQuickCustomerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, quickCustomerOpen]);

  useEffect(() => {
    if (!detailRecord) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDetailRecord(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailRecord]);

  const compatiblePrices = prices.filter((price) => price.priceType === "RECEIVING" && price.currency === "GHS" && price.priceUnit === formulaRules.priceUnit).slice(0, 1);
  const selectedCustomer = customers.find((customer) => customer.id === values.customerId);
  const selectedPrice = compatiblePrices.find((price) => price.id === values.boardPriceId);
  const calculation = useMemo(() => {
    if (!values.topGrams || !values.downGrams || !selectedPrice) return { result: null, error: "" };
    try {
      return {
        result: calculatePurchaseMeasurements(values.topGrams, values.downGrams, String(selectedPrice.priceAmount), formulaRules),
        error: "",
      };
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : "Check the entered measurements" };
    }
  }, [formulaRules, selectedPrice, values.downGrams, values.topGrams]);
  const karatLimitError = calculation.error.includes("Calculated karat exceeds 24");
  const amountPaid = amountPaidTouched
    ? values.amountPaid
    : calculation.result?.amount.toFixed(2) ?? "0.00";
  const paymentAmountValid = /^\d{1,14}(?:\.\d{1,2})?$/.test(amountPaid);
  const paymentError = !financingAccountId && calculation.result && paymentAmountValid && calculation.result.amount.lessThan(amountPaid)
    ? "Amount paid cannot exceed the calculated purchase amount."
    : "";

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const [customerResponse, priceResponse, recordResponse, accountResponse, formulaResponse, financingResponse] = await Promise.all([
        fetch("/api/customers?kind=SUPPLIER&status=ACTIVE&pageSize=50", { cache: "no-store" }),
        fetch("/api/board-prices", { cache: "no-store" }),
        fetch("/api/receiving", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/receiving/formula", { cache: "no-store" }),
        canUseBuyerFinancing ? fetch("/api/buyer-financing", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const [customerBody, priceBody, recordBody, accountBody, formulaBody, financingBody] = await Promise.all([
        customerResponse.json(), priceResponse.json(), recordResponse.json(), accountResponse.json(), formulaResponse.json(), financingResponse?.json(),
      ]);
      if (!customerResponse.ok) throw new Error(responseMessage(customerBody, "Unable to load customers"));
      if (!priceResponse.ok) throw new Error(responseMessage(priceBody, "Unable to load gold board prices"));
      if (!recordResponse.ok) throw new Error(responseMessage(recordBody, "Unable to load receiving records"));
      if (!accountResponse.ok) throw new Error(responseMessage(accountBody, "Unable to load cash accounts"));
      if (!formulaResponse.ok) throw new Error(responseMessage(formulaBody, "Unable to load purchase formulas"));
      if (financingResponse && !financingResponse.ok) throw new Error(responseMessage(financingBody, "Unable to load buyer financing accounts"));
      const firstCustomerPage: Customer[] = Array.isArray(customerBody?.customers) ? customerBody.customers : [];
      const customerPageCount = Math.ceil(Number(customerBody?.total ?? firstCustomerPage.length) / 50);
      const extraCustomerPages = await Promise.all(Array.from({ length: Math.max(0, customerPageCount - 1) }, async (_, index) => {
        const pageResponse = await fetch(`/api/customers?kind=SUPPLIER&status=ACTIVE&pageSize=50&page=${index + 2}`, { cache: "no-store" });
        const pageBody: unknown = await pageResponse.json();
        if (!pageResponse.ok) throw new Error(responseMessage(pageBody, "Unable to load all registered customers"));
        return Array.isArray((pageBody as { customers?: unknown[] })?.customers)
          ? (pageBody as { customers: Customer[] }).customers
          : [];
      }));
      const nextCustomers = [...firstCustomerPage, ...extraCustomerPages.flat()];
      const nextPrices: BoardPrice[] = Array.isArray(priceBody) ? priceBody : [];
      const nextFormula = formulaBody as PurchaseFormulaRules;
      const nextAccounts: CashAccount[] = Array.isArray(accountBody) ? accountBody.filter((account: CashAccount) => account.currency === "GHS" && account.type) : [];
      const nextFinancingAccounts: FinancingAccount[] = ((financingBody as { accounts?: FinancingAccount[] } | null)?.accounts ?? [])
        .filter((account) => account.customer.isActive);
      const financingCustomers = new Map<string, Customer>();
      for (const account of nextFinancingAccounts) {
        financingCustomers.set(account.customer.id, {
          id: account.customer.id,
          code: account.customer.code,
          name: account.customer.name,
        });
      }
      setCustomers([
        ...nextCustomers,
        ...[...financingCustomers.values()].filter((customer) => !nextCustomers.some((supplier) => supplier.id === customer.id)),
      ]);
      setPrices(nextPrices);
      setFormulaRules(nextFormula);
      setFormulaRulesLoaded(true);
      setCashAccounts(nextAccounts);
      setFinancingAccounts(nextFinancingAccounts);
      setFinancingAccountId((current) => nextFinancingAccounts.some((account) => account.id === current) ? current : "");
      setRecords(Array.isArray(recordBody) ? recordBody : []);
      setValues((current) => ({
        ...current,
        cashAccountId: current.cashAccountId || nextAccounts[0]?.id || "",
        boardPriceId: nextPrices.find((price) => price.priceType === "RECEIVING" && price.currency === "GHS" && price.priceUnit === nextFormula.priceUnit)?.id || "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the receiving workspace");
    } finally {
      setLoading(false);
    }
  }, [canUseBuyerFinancing]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(() => load(true));

  function updateField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "amountPaid") setAmountPaidTouched(true);
  }

  function selectReceivingCustomer(customerId: string) {
    updateField("customerId", customerId);
    const selectedFinancingAccount = financingAccounts.find((account) => account.id === financingAccountId);
    if (selectedFinancingAccount && selectedFinancingAccount.customer.id !== customerId) {
      setFinancingAccountId("");
      setAmountPaidTouched(false);
    }
  }

  function selectFinancingAccount(accountId: string) {
    const selectedAccount = financingAccounts.find((account) => account.id === accountId);
    const previousAccount = financingAccounts.find((account) => account.id === financingAccountId);
    setFinancingAccountId(accountId);
    if (selectedAccount) {
      setValues((current) => ({ ...current, customerId: selectedAccount.customer.id }));
    } else if (previousAccount) {
      setValues((current) => previousAccount.customer.id === current.customerId
        ? { ...current, customerId: "" }
        : current);
    }
  }

  function editDraft(record: ReceivingRecord) {
    setFinancingAccountId("");
    setEditingId(record.id);
    setAmountPaidTouched(true);
    setValues({
      customerId: record.customerId ?? "",
      transactionDate: localDateTime(new Date(record.transactionDate)),
      batchNumber: record.inventoryBatchNumber ?? "",
      storageLocation: record.storageLocationName ?? "Main storage",
      topGrams: String(record.topGrams ?? ""),
      downGrams: String(record.downGrams ?? ""),
      boardPriceId: compatiblePrices[0]?.id ?? "",
      amountPaid: String(record.paymentAmount ?? "0"),
      cashAccountId: "",
      paymentMethod: record.paymentMethod || "CASH",
      note: record.note ?? "",
      supportingDocumentRef: record.supportingDocumentRef ?? "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(action: "DRAFT" | "COMPLETE") {
    setError("");
    if (!values.customerId) {
      setCustomerRequiredAlertOpen(true);
      return;
    }
    if (!values.boardPriceId) {
      setError("Select a gold board price before saving.");
      return;
    }
    if (!calculation.result) {
      setError(calculation.error || "Enter valid Top weight and Down weight values in grams to calculate this purchase.");
      return;
    }
    if (paymentError) {
      setError(paymentError);
      return;
    }
    if (!financingAccountId && !paymentAmountValid) {
      setError("Enter an amount paid of zero or more with up to 2 decimal places.");
      return;
    }
    setBusy(true);
    setBusyMessage(action === "COMPLETE" ? "Generating receipt…" : "Saving…");
    let navigatingToReceipt = false;
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const payload = {
        action,
        ...values,
        amountPaid: financingAccountId ? "0" : amountPaid,
        financingAccountId: action === "COMPLETE" ? financingAccountId : "",
        transactionDate: new Date(values.transactionDate).toISOString(),
      };
      const response = await fetch(editingId ? `/api/receiving/${editingId}` : "/api/receiving", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(body, "Unable to save this purchase"));
      const saved = body as ReceivingRecord;
      showToast(action === "DRAFT" ? `Draft ${saved.reference} saved. No stock or payment was created.` : `Purchase ${saved.reference} completed.`);
      setEditingId(null);
      setFinancingAccountId("");
      setAmountPaidTouched(false);
      setValues({ ...emptyForm(), boardPriceId: compatiblePrices[0]?.id ?? "" });
      if (action === "COMPLETE") {
        navigatingToReceipt = true;
        router.push(`/receive-stock/receipt/${saved.id}`);
      } else {
        await load();
      }
    } catch (cause) {
      if (cause instanceof ZodError) {
        setError(cause.issues.map((issue) => issue.message).join(" "));
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to save this purchase");
      }
    } finally {
      if (!navigatingToReceipt) {
        setBusy(false);
        setBusyMessage("");
      }
    }
  }

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setBusyMessage("Saving customer…");
    try {
      if (!quickCustomer.phone.trim()) throw new Error("Enter a phone number.");
      if (!quickCustomer.dateOfBirth) throw new Error("Enter the customer's date of birth.");
      const input = customerSchema.parse({
        ...quickCustomer,
        kind: "SUPPLIER",
        phone: `+233 ${quickCustomer.phone.replace(/^\+?233\s*/, "").trim()}`,
      });
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(body, "Unable to create customer"));
      const customer = body as Customer;
      setCustomers((current) => [customer, ...current]);
      setValues((current) => ({ ...current, customerId: customer.id }));
      setQuickCustomerOpen(false);
      setQuickCustomer(emptyQuickCustomer());
      showToast(`Customer ${customer.name} created and selected. Your purchase details were kept.`);
    } catch (cause) {
      if (cause instanceof ZodError) setError(cause.issues.map((issue) => issue.message).join(" "));
      else setError(cause instanceof Error ? cause.message : "Unable to create customer");
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  return <>
  <div className="space-y-3">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-[27px] font-bold leading-tight tracking-[-.03em] text-[#111820]">Receive / Buy Gold</h1>
        <p className="mt-0.5 text-[13px] text-[#637083]">{canWrite ? "Record gold purchased from a customer" : "View recorded purchases and receipts"}</p>
      </div>
    </div>

    {canWrite && formulaRulesLoaded && !formulaRules.ownerConfirmed && <AlertDialog open title="Formula approval required" variant="warning" description="The saved purchase formulas have not been confirmed by an administrator. Saving drafts is available; completing a purchase is disabled until the formulas are reviewed and confirmed in Settings." onConfirm={() => {}} />}
    <AlertDialog open={Boolean(error)} title="Receiving error" description={error} onConfirm={() => setError("")} />

    {!canWrite && <div role="status" className="receiving-readonly-notice rounded-lg border border-[#e8d9ad] bg-[#fff9e9] px-4 py-3 text-xs leading-5 text-[#6d571f]">
      Read-only access: you can review purchase records, open details, and view receipts. Recording or editing purchases is restricted to users with purchase access.
    </div>}

    {canWrite && <div className="grid items-start gap-2 xl:grid-cols-[1.2fr_.8fr]">
    <Card className="rounded-[10px]">
      <CardHeader className="px-3 pb-2 pt-2.5">
        <CardTitle className="text-[13px]">{editingId ? "Edit purchase draft" : "Customer information"}</CardTitle>
        <p className="text-[9px] text-[#8993a0]">Calculated measurements are read-only. Drafts do not post stock or payments.</p>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <FormField label="Select customer" htmlFor="receiving-customer">
            <div className="flex gap-2">
              <CustomerAutocomplete id="receiving-customer" customers={customers} value={values.customerId} onChange={selectReceivingCustomer} placeholder="Search registered customers" />
              {canCreateCustomer && <Button type="button" variant="gold" size="sm" className="h-9 shrink-0 px-2.5 text-[10px]" onClick={() => setQuickCustomerOpen(true)} aria-label="Create customer"><Plus size={14} /> New</Button>}
            </div>
          </FormField>
          <FormField label="Transaction date" htmlFor="receiving-date">
            <CalendarPicker id="receiving-date" includeTime value={values.transactionDate} onChange={(transactionDate) => updateField("transactionDate", transactionDate)} />
          </FormField>
          {selectedCustomer && <div className="rounded-lg border border-[#e4e9ee] bg-[#fbfcfd] p-2.5 sm:col-span-2">
            <p className="text-[10px] font-semibold text-[#273342]">{selectedCustomer.name}</p>
            <p className="mt-0.5 text-[9px] text-[#637083]">{selectedCustomer.code}</p>
            {canReadPersonal && <p className="mt-0.5 truncate text-[9px] text-[#637083]">{selectedCustomer.phone || "Phone not recorded"} · {selectedCustomer.address || "Address not recorded"}</p>}
          </div>}
          <FormField label="Storage location" htmlFor="receiving-location">
            <input id="receiving-location" value={values.storageLocation} onChange={(event) => updateField("storageLocation", event.target.value)} className={`${fieldControlClass}`} maxLength={120} required />
          </FormField>
        </div>
      </CardContent>
    </Card>
    <Card className="rounded-[10px]">
      <CardHeader className="px-3 pb-2 pt-2.5"><CardTitle className="text-[13px]">Transaction details</CardTitle></CardHeader>
      <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
        <FormField label="Recorded by" htmlFor="receiving-recorded-by">
          <input id="receiving-recorded-by" value={recordedBy} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
        </FormField>
        {canUseBuyerFinancing && <FormField label="Buyer financing (optional)" htmlFor="receiving-financing" hint="Selecting an account also selects its buyer as the purchase customer. Use this when that buyer is supplying the gold.">
          <select id="receiving-financing" value={financingAccountId} onChange={(event) => selectFinancingAccount(event.target.value)} className={fieldControlClass}>
            <option value="">Do not apply buyer financing</option>
            {financingAccounts.map((account) => {
              const balance = Number(account.balance);
              const position = balance > 0 ? `Customer owes ${formatCurrency(balance)}` : balance < 0 ? `Big Joe owes ${formatCurrency(Math.abs(balance))}` : "Settled";
              return <option key={account.id} value={account.id}>{account.customer.name} ({account.customer.code}) · {position}</option>;
            })}
          </select>
        </FormField>}
        {financingAccountId && calculation.result && <p className="rounded-md border border-[#d6aa42] bg-[#f8e6b0] px-3 py-2 text-[10px] text-[#465362] sm:col-span-2">
          Gold value {formatCurrency(calculation.result.amount.toFixed(2))} will be applied to {financingAccounts.find((account) => account.id === financingAccountId)?.customer.name}&apos;s financing balance.
          {(() => {
            const balance = new Prisma.Decimal(financingAccounts.find((account) => account.id === financingAccountId)?.balance ?? 0)
              .minus(calculation.result.amount);
            return balance.greaterThan(0)
              ? ` Customer will still owe ${formatCurrency(balance.toFixed(2))}.`
              : balance.lessThan(0)
                ? ` Big Joe will owe the customer ${formatCurrency(balance.abs().toFixed(2))}.`
                : " The account will be settled.";
          })()}
        </p>}
      </CardContent>
    </Card>

    <Card className="rounded-[10px]">
      <CardHeader className="px-3 pb-2 pt-2.5"><CardTitle className="text-[13px]">Gold measurement</CardTitle></CardHeader>
      <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
          <FormField label="Top weight (g)" htmlFor="receiving-top-weight" hint="Enter the top weight in grams.">
            <input id="receiving-top-weight" type="number" min="0.00001" step="0.00001" max="999999.99999999" value={values.topGrams} onChange={(event) => updateField("topGrams", event.target.value)} className={`${fieldControlClass}`} />
          </FormField>
          <FormField label="Down weight (g)" htmlFor="receiving-down-weight" hint="Enter the down weight in grams.">
            <input id="receiving-down-weight" type="number" min="0.00001" step="0.00001" max="999999.99999999" value={values.downGrams} onChange={(event) => updateField("downGrams", event.target.value)} className={`${fieldControlClass}`} aria-invalid={karatLimitError} aria-describedby={karatLimitError ? "receiving-karat-limit-error" : undefined} />
            {karatLimitError && <p id="receiving-karat-limit-error" role="alert" className="mt-1 text-[10px] leading-4 text-rose-700">{calculation.error}</p>}
          </FormField>
          <FormField label="Pounds (auto)" htmlFor="receiving-pounds">
            <input id="receiving-pounds" value={calculation.result ? formatTwoDecimalTruncated(calculation.result.pounds.toString()) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
          <FormField label="Density (auto)" htmlFor="receiving-density">
            <input id="receiving-density" value={calculation.result ? formatTwoDecimalTruncated(calculation.result.density.toString()) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
          <FormField label="Karat (auto)" htmlFor="receiving-karat">
            <input id="receiving-karat" value={calculation.result ? formatTwoDecimalTruncated(calculation.result.karat.toString()) : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
          <FormField label="Purity (auto)" htmlFor="receiving-purity">
            <input id="receiving-purity" value={calculation.result ? `${formatTwoDecimalTruncated(calculation.result.purity.toString())}%` : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
      </CardContent>
    </Card>

    <Card className="rounded-[10px]">
      <CardHeader className="px-3 pb-2 pt-2.5"><CardTitle className="text-[13px]">Gold price &amp; calculations</CardTitle></CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
          <FormField label="Current gold price (GHS)" htmlFor="receiving-price" hint={selectedPrice ? `Published ${formatDate(selectedPrice.effectiveAt)} · ${selectedPrice.source}` : "Publish a compatible GHS board price to begin."}>
            <input id="receiving-price" value={selectedPrice ? `${selectedPrice.currency} ${selectedPrice.priceAmount}` : "No compatible published price"} readOnly className={`${fieldControlClass}`} />
          </FormField>
          <FormField label="Price unit" htmlFor="receiving-price-unit">
            <input id="receiving-price-unit" value={selectedPrice ? selectedPrice.priceUnit : "Select a compatible board price"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
          <div className="rounded-lg border border-[#b88d24] bg-[#292313] p-2.5">
            <p className="text-[9px] font-semibold text-[#ffd344]">Actual gold amount (GHS)</p>
            <p id="receiving-amount" className="mt-1 text-[19px] font-bold leading-tight tabular-nums text-[#ffd344]">{calculation.result ? formatCurrencyWholeGhsTruncated(calculation.result.amount.toString()) : "—"}</p>
          </div>
      </CardContent>
    </Card>

    <Card className="rounded-[10px] xl:col-span-2">
      <CardHeader className="px-3 pb-2 pt-2.5"><CardTitle className="text-[13px]">Payment information</CardTitle></CardHeader>
      <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Payment method" htmlFor="receiving-method">
            <select id="receiving-method" value={values.paymentMethod} onChange={(event) => updateField("paymentMethod", event.target.value)} className={`${fieldControlClass}`}>
              {paymentMethods.map((method) => <option key={method} value={method}>{method.replaceAll("_", " ")}</option>)}
            </select>
          </FormField>
          <FormField label="Cash / bank account" htmlFor="receiving-account" hint={financingAccountId ? "Not used when buyer financing is applied." : "Required when an amount is paid."}>
            <select id="receiving-account" disabled={Boolean(financingAccountId)} value={values.cashAccountId} onChange={(event) => updateField("cashAccountId", event.target.value)} className={`${fieldControlClass}`}>
              <option value="">Select an account</option>
              {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}
            </select>
          </FormField>
          <FormField label={financingAccountId ? "Financed purchase value (GHS)" : "Amount paid (GHS)"} htmlFor="receiving-paid" hint={financingAccountId ? "No cash payment is recorded. The calculated gold value settles the financing balance." : "Defaults to the calculated actual gold amount; edit if a different amount was paid."}>
            <GhanaAmountInput id="receiving-paid" min="0" step="0.01" disabled={Boolean(financingAccountId)} value={financingAccountId ? calculation.result?.amount.toFixed(2) ?? "0.00" : amountPaid} onChange={(value) => updateField("amountPaid", value)} onBlur={() => { if (!values.amountPaid.trim() && amountPaidTouched) { setValues((current) => ({ ...current, amountPaid: "0" })); setAmountPaidTouched(false); } }} className={`${fieldControlClass} ${financingAccountId ? "bg-[#f7f8fa]" : ""}`} />
          </FormField>
          <FormField label="Outstanding (GHS)" htmlFor="receiving-balance">
            <input id="receiving-balance" value={financingAccountId ? formatCurrencyExact("0.00") : calculation.result ? formatCurrencyExact(calculation.result.amount.minus(paymentAmountValid ? amountPaid : "0").greaterThan(0) ? calculation.result.amount.minus(paymentAmountValid ? amountPaid : "0").toFixed(2) : "0.00") : "—"} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
          </FormField>
          <FormField label="Notes" htmlFor="receiving-notes" className="sm:col-span-2 xl:col-span-4">
            <textarea id="receiving-notes" rows={2} value={values.note} onChange={(event) => updateField("note", event.target.value)} className={`${fieldControlClass} h-auto resize-y py-2`} maxLength={500} />
          </FormField>
        <AlertDialog
          open={Boolean((calculation.error && !karatLimitError) || paymentError)}
          title={paymentError ? "Payment amount invalid" : "Calculation error"}
          description={paymentError || calculation.error}
          onConfirm={() => {}}
        />
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 xl:col-span-4">
          <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" disabled={busy || loading} onClick={() => { setEditingId(null); setFinancingAccountId(""); setAmountPaidTouched(false); setValues({ ...emptyForm(), boardPriceId: compatiblePrices[0]?.id ?? "", cashAccountId: cashAccounts[0]?.id ?? "" }); setError(""); }}><X size={12} /> Clear</Button>
          {canWrite && <Button type="button" variant="outline" size="sm" className="h-8 border-[#d6aa42] bg-[#f8e6b0] text-[10px] text-[#6d4d13] hover:bg-[#f1d98c]" disabled={busy || loading} onClick={() => { void save("DRAFT"); }}><Save size={12} />{busy ? "Saving…" : "Save as Draft"}</Button>}
          {canWrite && (formulaRules.ownerConfirmed
            ? <Button type="button" variant="gold" size="sm" className="h-8 bg-[#f6bd2d] text-[10px] text-[#17212f] hover:bg-[#e9ae1d]" disabled={busy || loading || !calculation.result || Boolean(paymentError)} onClick={() => { void save("COMPLETE"); }}>{busy && busyMessage ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : <Check size={12} />}{busy && busyMessage ? busyMessage : "Complete Purchase"}</Button>
            : <Button type="button" variant="gold" size="sm" className="h-8 text-[10px]" disabled>Complete Purchase — owner confirmation required</Button>)}
          {editingId && <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" disabled={busy} onClick={() => { setEditingId(null); setFinancingAccountId(""); setAmountPaidTouched(false); setValues({ ...emptyForm(), boardPriceId: compatiblePrices[0]?.id ?? "" }); }}>Cancel edit</Button>}
        </div>
      </CardContent>
    </Card>
    </div>}

    {canWrite && quickCustomerOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setQuickCustomerOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="quick-customer-title" className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-[#fbfcfe] p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="quick-customer-title" className="text-2xl font-bold tracking-tight text-[#17212f]">Add New Customer</h2><p className="mt-1 text-sm text-[#637083]">Create a new customer and register their information.</p></div>
          <button type="button" onClick={() => setQuickCustomerOpen(false)} aria-label="Close customer form" disabled={busy} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50"><X size={16} /></button>
        </div>
        <form onSubmit={createCustomer} className="mt-5">
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><UserRound size={17} /></span>Personal Information</h3>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <FormField label="Full Name *" htmlFor="quick-customer-name"><input id="quick-customer-name" required minLength={2} placeholder="Enter full name" value={quickCustomer.name} onChange={(event) => setQuickCustomer((current) => ({ ...current, name: event.target.value }))} className={fieldControlClass} autoComplete="name" /></FormField>
                <FormField label="Customer ID (Auto)" htmlFor="quick-customer-code"><input id="quick-customer-code" value="Generated when saved" readOnly className={fieldControlClass} /></FormField>
                <FormField label="Phone Number *" htmlFor="quick-customer-phone">
                  <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#dfe4e9] bg-white shadow-sm shadow-[#17212f]/[.025] focus-within:border-[#bc8c36] focus-within:ring-4 focus-within:ring-[#bc8c36]/10">
                    <span className="flex h-full shrink-0 items-center gap-1.5 border-r border-[#e8ebef] bg-[#fbfcfe] px-3 text-xs font-medium text-[#465362]">🇬🇭 +233</span>
                    <input id="quick-customer-phone" type="tel" required autoComplete="tel-national" placeholder="Enter phone number" value={quickCustomer.phone} onChange={(event) => setQuickCustomer((current) => ({ ...current, phone: event.target.value }))} className="h-full min-w-0 flex-1 px-3 text-[13px] text-[#263241] outline-none placeholder:text-[#a0a8b2]" />
                  </div>
                </FormField>
                <FormField label="Email Address" htmlFor="quick-customer-email"><input id="quick-customer-email" type="email" placeholder="Enter email address" value={quickCustomer.email} onChange={(event) => setQuickCustomer((current) => ({ ...current, email: event.target.value }))} className={fieldControlClass} autoComplete="email" /></FormField>
                <FormField label="Date of Birth *" htmlFor="quick-customer-dob"><GhanaDateInput id="quick-customer-dob" value={quickCustomer.dateOfBirth} required onChange={(dateOfBirth) => setQuickCustomer((current) => ({ ...current, dateOfBirth }))} /></FormField>
                <FormField label="Gender" htmlFor="quick-customer-gender"><select id="quick-customer-gender" value={quickCustomer.gender} onChange={(event) => setQuickCustomer((current) => ({ ...current, gender: event.target.value as QuickCustomer["gender"] }))} className={fieldControlClass}><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></FormField>
                <FormField label="ID Type" htmlFor="quick-customer-id-type"><select id="quick-customer-id-type" value={quickCustomer.idType} onChange={(event) => setQuickCustomer((current) => ({ ...current, idType: event.target.value as QuickCustomer["idType"] }))} className={fieldControlClass}><option value="">Select ID type</option><option value="GHANA_CARD">Ghana Card</option><option value="PASSPORT">Passport</option><option value="DRIVERS_LICENSE">Driver’s license</option><option value="VOTER_ID">Voter ID</option><option value="OTHER">Other</option></select></FormField>
                <FormField label="ID Number" htmlFor="quick-customer-id-number"><input id="quick-customer-id-number" placeholder="Enter ID number" value={quickCustomer.idNumber} onChange={(event) => setQuickCustomer((current) => ({ ...current, idNumber: event.target.value }))} className={fieldControlClass} /></FormField>
              </div>
            </section>
            <div className="grid content-start gap-3">
              <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><MapPin size={17} /></span>Address Information</h3>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <FormField label="Address Line 1" htmlFor="quick-customer-address1"><input id="quick-customer-address1" placeholder="Enter house number, street name" value={quickCustomer.addressLine1} onChange={(event) => setQuickCustomer((current) => ({ ...current, addressLine1: event.target.value }))} className={fieldControlClass} autoComplete="address-line1" /></FormField>
                  <FormField label="Address Line 2 (Optional)" htmlFor="quick-customer-address2"><input id="quick-customer-address2" placeholder="Enter apartment, suite, etc." value={quickCustomer.addressLine2} onChange={(event) => setQuickCustomer((current) => ({ ...current, addressLine2: event.target.value }))} className={fieldControlClass} autoComplete="address-line2" /></FormField>
                  <FormField label="City / Town" htmlFor="quick-customer-city"><input id="quick-customer-city" placeholder="Enter city or town" value={quickCustomer.city} onChange={(event) => setQuickCustomer((current) => ({ ...current, city: event.target.value }))} className={fieldControlClass} autoComplete="address-level2" /></FormField>
                  <FormField label="Region" htmlFor="quick-customer-region"><select id="quick-customer-region" value={quickCustomer.region} onChange={(event) => setQuickCustomer((current) => ({ ...current, region: event.target.value }))} className={fieldControlClass}><option value="">Select region</option>{ghanaRegions.map((region) => <option key={region} value={region}>{region}</option>)}</select></FormField>
                  <FormField label="Country" htmlFor="quick-customer-country"><select id="quick-customer-country" value={quickCustomer.country} onChange={(event) => setQuickCustomer((current) => ({ ...current, country: event.target.value }))} className={fieldControlClass}><option value="Ghana">Ghana</option></select></FormField>
                  <FormField label="GPS Location (Optional)" htmlFor="quick-customer-gps"><input id="quick-customer-gps" placeholder="Enter GPS coordinates" value={quickCustomer.gpsLocation} onChange={(event) => setQuickCustomer((current) => ({ ...current, gpsLocation: event.target.value }))} className={fieldControlClass} /></FormField>
                </div>
              </section>
              <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><FileText size={17} /></span>Additional Information</h3>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <FormField label="Customer Type" htmlFor="quick-customer-type"><select id="quick-customer-type" value={quickCustomer.type} onChange={(event) => setQuickCustomer((current) => ({ ...current, type: event.target.value === "BUSINESS" ? "BUSINESS" : "INDIVIDUAL" }))} className={fieldControlClass}><option value="">Select customer type</option><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></FormField>
                  <FormField label="Status" htmlFor="quick-customer-status"><select id="quick-customer-status" value="ACTIVE" disabled className={`${fieldControlClass} border-emerald-200 bg-emerald-50 text-emerald-700`}><option value="ACTIVE">Active</option></select></FormField>
                  <FormField label="Notes (Optional)" htmlFor="quick-customer-notes" className="sm:col-span-2"><textarea id="quick-customer-notes" rows={3} placeholder="Add any additional notes about this customer…" value={quickCustomer.notes} onChange={(event) => setQuickCustomer((current) => ({ ...current, notes: event.target.value }))} className={`${fieldControlClass} h-auto resize-y py-3`} /></FormField>
                </div>
              </section>
            </div>
          </div>
          <div className="quick-customer-form-footer sticky bottom-0 z-10 -mx-5 mt-5 flex justify-between gap-2 border-t border-[#e8edf3] bg-[#fbfcfe]/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setQuickCustomerOpen(false)}><X size={15} /> Cancel</Button>
            <Button type="submit" variant="gold" disabled={busy}>{busy ? "Saving…" : <><Plus size={15} /> Save Customer</>}</Button>
          </div>
        </form>
      </section>
    </div>}
    {busy && busyMessage === "Generating receipt…" && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0c1521]/70 p-4 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="flex min-w-[260px] flex-col items-center gap-3 rounded-xl border border-[#d6aa42] bg-white px-8 py-7 text-center shadow-2xl">
        <LoaderCircle size={34} className="animate-spin text-[#a97520]" aria-hidden="true" />
        <p className="text-sm font-semibold text-[#17212f]">Generating receipt…</p>
        <p className="text-xs text-[#637083]">Please wait while we save the purchase and prepare your receipt.</p>
      </div>
    </div>}

    <Card className="overflow-hidden rounded-[10px]">
      <CardHeader className="flex-row items-center justify-between gap-4 px-3 pb-2.5 pt-3">
        <div><CardTitle className="text-[13px]">Recent purchases and drafts</CardTitle><p className="mt-0.5 text-[9px] text-[#89929d]">{loading ? "Loading records…" : `${records.length} records returned`}</p></div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead><tr className="border-y border-[#edf0f3] bg-[#fafbfc] text-[9px] font-semibold uppercase tracking-[.06em] text-[#89929d]">
            <th className="px-3 py-2.5">Reference</th><th className="px-3 py-2.5">Customer</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Top weight (g)</th><th className="px-3 py-2.5">Karat</th><th className="px-3 py-2.5">Amount</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Actions</th>
          </tr></thead>
          <tbody>{records.map((record) => <tr key={record.id} className="border-b border-[#f0f2f4] text-[10px] text-[#63707e] transition-colors hover:bg-[#fcfcfb]">
            <td className="whitespace-nowrap px-3 py-2.5">
              <button type="button" onClick={() => setDetailRecord(record)} className="font-semibold text-[#8a611f] underline decoration-[#d6aa42] underline-offset-2 hover:text-[#62430e] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bc8c36]">{record.reference}</button>
            </td>
            <td className="px-3 py-2.5">{record.customer?.name ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2.5">{formatDate(record.transactionDate)}</td>
            <td className="px-3 py-2.5 tabular-nums">{record.topGrams ? `${record.topGrams} g` : "—"}</td>
            <td className="px-3 py-2.5 tabular-nums">{record.karat === null ? "—" : formatTwoDecimalTruncated(record.karat)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums text-[#344151]">{formatCurrencyExact(String(record.totalAmount))}{record.buyerFinanceSettlement && <p className="mt-1 text-[9px] font-normal text-[#637083]">Applied from {record.buyerFinanceSettlement.account.customer.name}&apos;s financing</p>}</td>
            <td className="px-3 py-2.5"><Badge tone={record.status === "POSTED" ? "green" : "gold"}>{record.status === "POSTED" ? "Completed" : "Draft"}</Badge></td>
            <td className="px-3 py-2.5">
              {record.status === "DRAFT" && canWrite
                ? <Button size="sm" variant="outline" onClick={() => editDraft(record)}>Open draft</Button>
                : record.status === "POSTED"
                  ? <Link href={`/receive-stock/receipt/${record.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#dfe4e9] px-2 text-[10px] font-medium text-[#52606d] hover:bg-[#f7f8fa]"><Printer size={12} /> Receipt</Link>
                  : "—"}
            </td>
          </tr>)}</tbody>
        </table>
        {!loading && records.length === 0 && <p className="px-5 py-8 text-center text-xs text-[#89929d]">No gold purchases or drafts have been recorded.</p>}
      </CardContent>
    </Card>
    {detailRecord && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailRecord(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#9a6a1d]">Gold purchase details</p>
            <h2 id="purchase-detail-title" className="mt-1 text-xl font-bold tracking-tight text-[#17212f]">{detailRecord.reference}</h2>
            <p className="mt-1 text-xs text-[#76808c]">{detailRecord.customer?.name ?? "No customer"}{detailRecord.customer?.code ? ` · ${detailRecord.customer.code}` : ""}</p>
          </div>
          <button type="button" onClick={() => setDetailRecord(null)} aria-label="Close purchase details" className="rounded-lg p-2 text-[#74808d] transition hover:bg-[#f3f4f6] hover:text-[#17212f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bc8c36]"><X size={18} /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <PurchaseDetail label="Status">{detailRecord.status === "POSTED" ? "Completed" : detailRecord.status === "DRAFT" ? "Draft" : "Voided"}</PurchaseDetail>
          <PurchaseDetail label="Transaction date">{formatDate(detailRecord.transactionDate)}</PurchaseDetail>
          <PurchaseDetail label="Batch number">{detailRecord.inventoryBatchNumber || "—"}</PurchaseDetail>
          <PurchaseDetail label="Storage location">{detailRecord.storageLocationName || "—"}</PurchaseDetail>
          <PurchaseDetail label="Top weight">{detailRecord.topGrams == null ? "—" : `${formatTwoDecimalTruncated(detailRecord.topGrams)} g`}</PurchaseDetail>
          <PurchaseDetail label="Down weight">{detailRecord.downGrams == null ? "—" : `${formatTwoDecimalTruncated(detailRecord.downGrams)} g`}</PurchaseDetail>
          <PurchaseDetail label="Weight">{detailRecord.pounds == null ? "—" : `${formatTwoDecimalTruncated(detailRecord.pounds)} lb`}</PurchaseDetail>
          <PurchaseDetail label="Density">{detailRecord.density == null ? "—" : formatTwoDecimalTruncated(detailRecord.density)}</PurchaseDetail>
          <PurchaseDetail label="Karat">{detailRecord.karat == null ? "—" : `${formatTwoDecimalTruncated(detailRecord.karat)}K`}</PurchaseDetail>
          <PurchaseDetail label="Gold price">{`${formatCurrencyExact(String(detailRecord.pricePerGram))} / ${detailRecord.priceUnit.replaceAll("_", " ").toLowerCase()}`}</PurchaseDetail>
          <PurchaseDetail label="Actual gold amount">{formatCurrencyExact(String(detailRecord.totalAmount))}</PurchaseDetail>
          <PurchaseDetail label="Amount paid">{formatCurrencyExact(String(detailRecord.paymentAmount))}</PurchaseDetail>
          <PurchaseDetail label="Payment method">{detailRecord.paymentMethod.replaceAll("_", " ")}</PurchaseDetail>
          {detailRecord.buyerFinanceSettlement && <PurchaseDetail label="Financing applied">{`${formatCurrencyExact(String(detailRecord.buyerFinanceSettlement.amount))} from ${detailRecord.buyerFinanceSettlement.account.customer.name} (${detailRecord.buyerFinanceSettlement.reference})`}</PurchaseDetail>}
          <PurchaseDetail label="Recorded by">{detailRecord.createdBy.name}</PurchaseDetail>
          {detailRecord.supportingDocumentRef && <PurchaseDetail label="Supporting document">{detailRecord.supportingDocumentRef}</PurchaseDetail>}
          {detailRecord.note && <PurchaseDetail label="Notes" className="sm:col-span-2">{detailRecord.note}</PurchaseDetail>}
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="outline" onClick={() => setDetailRecord(null)}>Close</Button>
        </div>
      </section>
    </div>}
    <AlertDialog
      open={customerRequiredAlertOpen}
      title="Customer required"
      description="Select a customer before saving."
      onConfirm={() => setCustomerRequiredAlertOpen(false)}
    />
  </div></>;
}

function PurchaseDetail({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-xl border border-[#edf0f3] bg-[#fafbfc] px-3.5 py-3 ${className}`}>
    <p className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#89929d]">{label}</p>
    <p className="mt-1 break-words text-xs font-medium leading-5 text-[#293442]">{children}</p>
  </div>;
}
