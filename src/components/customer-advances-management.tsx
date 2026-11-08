"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Prisma } from "@prisma/client";
import { Check, Plus, WalletCards, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { StockAutocomplete, type StockOption } from "@/components/ui/stock-autocomplete";
import { PaymentProcessingOverlay } from "@/components/ui/payment-processing-overlay";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { calculateMeasuredSaleQuote, inferSaleDownWeightFromReceipts } from "@/lib/gold";
import { adjustSaleAllocations } from "@/lib/sales-allocation";
import { formatCurrency, formatPriceAmount, formatTwoDecimalTruncated, formatWeight } from "@/lib/formatters";
import { DEFAULT_PURCHASE_FORMULA_RULES, type PurchaseFormulaRules } from "@/lib/purchase-formula";
import { fetchAllCustomers } from "@/lib/customer-client";
import { customerSchema, type CustomerInput } from "@/lib/validation";
import { useToast } from "@/components/ui/toast-provider";

type Customer = { id: string; name: string; code: string };
type CashAccount = { id: string; name: string; type: string; currency: string; isActive: boolean };
type BoardPrice = { priceType: "RECEIVING" | "SELLING"; priceAmount: string | number; currency: string; priceUnit: string; source: string; effectiveAt: string };
type Lot = { id: string; batchNumber: string; source?: string; receivedAt: string; status: string; remainingGrams: string | number; purityBps: number; costPerGram: string | number; ledgerBalanceGrams: string | number; trade?: { purchaseMeasurement: { topKg: string | number; downKg: string | number } | null } | null };
type AdvancePayment = { id: string; reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; referencePricePerGram: string | number | null; referencePriceSource: string | null; referencePriceEffectiveAt: string | null; method: string; paidAt: string; note: string | null; cashAccount: { name: string } | null };
type Fulfillment = { reference: string; grams: string | number; amount: string | number; pricePerGram: string | number; purityBps: number; createdAt: string; trade: { id: string; reference: string; transactionDate: string }; boardPrice: { source: string; effectiveAt: string } };
type FulfillAllocation = { lotId: string; grams: string };
type GoldRequest = { id: string; reference: string; requestedGrams: string | number; fulfilledGrams: string | number; remainingGrams: string | number; note: string | null; createdAt: string; fulfillments: Fulfillment[] };
type Advance = { id: string; reference: string; note: string | null; createdAt: string; receivedAmount: string | number; refundedAmount: string | number; fulfilledAmount: string | number; balance: string | number; customer: Customer; payments: AdvancePayment[]; requests: GoldRequest[] };
type AdvanceAction = "CREATE_ADVANCE" | "ADD_FUNDS" | "REFUND";

const paymentMethods = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"] as const;
const ghanaRegions = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern",
  "Greater Accra", "North East", "Northern", "Oti", "Savannah",
  "Upper East", "Upper West", "Volta", "Western", "Western North",
];
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const formatDate = (value: string) => new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
const currency = (value: string | number) => formatCurrency(value);

function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
}

export function CustomerAdvancesManagement({ canWrite, canCreateCustomer, canFulfill }: { canWrite: boolean; canCreateCustomer: boolean; canFulfill: boolean }) {
  const router = useRouter();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [boardPrice, setBoardPrice] = useState<BoardPrice | null>(null);
  const [selectedAdvanceId, setSelectedAdvanceId] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<(typeof paymentMethods)[number]>("CASH");
  const [paidAt, setPaidAt] = useState(localDateTime);
  const [note, setNote] = useState("");
  const [requestedGrams, setRequestedGrams] = useState("");
  const [requestedGoldUnit, setRequestedGoldUnit] = useState<"g" | "kg">("g");
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([]);
  const [fulfillmentAllocations, setFulfillmentAllocations] = useState<FulfillAllocation[]>([]);
  const [measurementTopGrams, setMeasurementTopGrams] = useState("");
  const [measurementDownGrams, setMeasurementDownGrams] = useState("");
  const [measurementConfirmed, setMeasurementConfirmed] = useState(false);
  const [measurementModalOpen, setMeasurementModalOpen] = useState(false);
  const [formulaRules, setFormulaRules] = useState<PurchaseFormulaRules>(DEFAULT_PURCHASE_FORMULA_RULES);
  const [transactionDate, setTransactionDate] = useState(localDateTime);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [fulfillmentProcessing, setFulfillmentProcessing] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CustomerInput>({
    name: "",
    kind: "BUYER",
    type: "INDIVIDUAL",
    phone: "",
    email: "",
    country: "Ghana",
  });

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCustomerBusy(true);
    try {
      const phone = newCustomer.phone?.trim() ?? "";
      const nationalNumber = phone.replace(/^\+?233\s*/, "").replace(/^0/, "").trim();
      const input = customerSchema.parse({
        ...newCustomer,
        kind: "BUYER",
        phone: nationalNumber ? `+233 ${nationalNumber}` : "",
        dateOfBirth: newCustomer.dateOfBirth || "",
        country: newCustomer.country || "Ghana",
        address: [newCustomer.addressLine1, newCustomer.addressLine2].filter(Boolean).join(", ") || newCustomer.address || "",
      });
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to create customer"));
      if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string"
        || !("name" in body) || typeof body.name !== "string" || !("code" in body) || typeof body.code !== "string") {
        throw new Error("The customer service returned an invalid response");
      }
      const customer = body as Customer;
      setCustomers((current) => [...current, customer]);
      setCustomerId(customer.id);
      setNewCustomer({ name: "", kind: "BUYER", type: "INDIVIDUAL", phone: "", alternativePhone: "", email: "", dateOfBirth: "", gender: "", idType: "", idNumber: "", tin: "", address: "", addressLine1: "", addressLine2: "", city: "", region: "", country: "Ghana", gpsLocation: "", notes: "" });
      setShowCustomerForm(false);
      showToast(`${customer.name} was added and selected. You can now record the cash advance.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create customer");
    } finally {
      setCustomerBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [advanceResponse, accountResponse, inventoryResponse, formulaResponse, nextCustomers] = await Promise.all([
        fetch("/api/customer-advances", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        canFulfill ? fetch("/api/inventory", { cache: "no-store" }) : Promise.resolve(null),
        canFulfill ? fetch("/api/receiving/formula", { cache: "no-store" }) : Promise.resolve(null),
        fetchAllCustomers<Customer>("BUYER"),
      ]);
      const [advanceBody, accountBody, inventoryBody, formulaBody] = await Promise.all([
        advanceResponse.json(), accountResponse.json(), inventoryResponse?.json(), formulaResponse?.json(),
      ]);
      for (const [response, body, label] of [
        [advanceResponse, advanceBody, "customer advances"],
        [accountResponse, accountBody, "cash accounts"],
        ...(inventoryResponse ? [[inventoryResponse, inventoryBody, "available gold stock"] as const] : []),
        ...(formulaResponse ? [[formulaResponse, formulaBody, "gold measurement formula"] as const] : []),
      ] as const) {
        if (!response.ok) throw new Error(messageFrom(body, `Unable to load ${label}`));
      }
      const advanceData = advanceBody as { advances?: Advance[]; currentBoardPrice?: BoardPrice | null };
      const nextAdvances = Array.isArray(advanceData.advances) ? advanceData.advances : [];
      const nextAccounts = Array.isArray(accountBody) ? accountBody.filter((item: CashAccount) => item.isActive && item.currency === "GHS") as CashAccount[] : [];
      const inventory = (inventoryBody ?? {}) as { lots?: Lot[] };
      const nextLots = (inventory.lots ?? []).filter((lot) => lot.status === "ACTIVE" && Number(lot.ledgerBalanceGrams) > 0);
      setAdvances(nextAdvances);
      setCustomers(nextCustomers);
      setAccounts(nextAccounts);
      setLots(nextLots);
      setBoardPrice(advanceData.currentBoardPrice ?? null);
      if (formulaBody && "version" in formulaBody) setFormulaRules(formulaBody);
      setSelectedAdvanceId((current) => nextAdvances.some((advance) => advance.id === current) ? current : nextAdvances[0]?.id ?? "");
      const nextOpenRequestIds = new Set(nextAdvances.flatMap((advance) => advance.requests
        .filter((request) => Number(request.remainingGrams) > 0)
        .map((request) => request.id)));
      setSelectedRequestId((current) => nextOpenRequestIds.has(current) ? current : nextOpenRequestIds.values().next().value ?? "");
      setCustomerId((current) => current || nextCustomers[0]?.id || "");
      setAccountId((current) => nextAccounts.some((item) => item.id === current) ? current : nextAccounts[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load customer advances");
    } finally {
      setLoading(false);
    }
  }, [canFulfill]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedAdvance = advances.find((advance) => advance.id === selectedAdvanceId);
  const openRequests = advances.flatMap((advance) => advance.requests
    .filter((request) => Number(request.remainingGrams) > 0)
    .map((request) => ({ ...request, advance, customer: advance.customer })));
  const selectedRequest = openRequests.find((request) => request.id === selectedRequestId);
  const selectableFulfillmentLots = lots.filter((lot) => lot.status === "ACTIVE"
    && Number(lot.ledgerBalanceGrams) > 0
    && !fulfillmentAllocations.some((allocation) => allocation.lotId === lot.id));
  const allocatedFulfillmentDecimal = fulfillmentAllocations.reduce((sum, allocation) => sum.plus(allocation.grams), new Prisma.Decimal(0));
  const allocatedFulfillmentGrams = allocatedFulfillmentDecimal.toNumber();
  const measurement = useMemo(() => {
    if (!measurementTopGrams || !measurementDownGrams || !boardPrice) return { result: null, error: "" };
    try {
      return {
        result: calculateMeasuredSaleQuote(measurementTopGrams, measurementDownGrams, String(boardPrice.priceAmount), "0", formulaRules),
        error: "",
      };
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : "Check the entered gold measurements" };
    }
  }, [measurementTopGrams, measurementDownGrams, boardPrice, formulaRules]);
  const allocationAdjustment = useMemo(() => {
    if (!fulfillmentAllocations.length || !measurement.result) return { allocations: null, error: "" };
    try {
      return {
        allocations: adjustSaleAllocations(
          fulfillmentAllocations,
          lots.map((lot) => ({ id: lot.id, remainingGrams: lot.ledgerBalanceGrams })),
          measurementTopGrams,
        ),
        error: "",
      };
    } catch (cause) {
      return { allocations: null, error: cause instanceof Error ? cause.message : "The selected batches cannot cover this top weight" };
    }
  }, [fulfillmentAllocations, lots, measurement.result, measurementTopGrams]);
  const weightedPurityBps = measurement.result?.purityBps ?? 0;
  const fulfillmentQuote = useMemo(() => {
    if (!measurementConfirmed || !measurement.result || !allocatedFulfillmentDecimal.greaterThan(0)
      || !measurement.result.topGrams.equals(allocatedFulfillmentDecimal)) return null;
    return measurement.result.total.toFixed(2);
  }, [measurementConfirmed, measurement.result, allocatedFulfillmentDecimal]);

  function updateFulfillmentMeasurements(allocations: FulfillAllocation[]) {
    const totalGrams = allocations.reduce((sum, allocation) => sum.plus(allocation.grams || 0), new Prisma.Decimal(0));
    setMeasurementTopGrams(totalGrams.isZero() ? "" : totalGrams.toString());
    const downGrams = inferSaleDownWeightFromReceipts(
      allocations,
      lots.map((lot) => ({ id: lot.id, purchaseMeasurement: lot.trade?.purchaseMeasurement ?? null })),
    );
    setMeasurementDownGrams(downGrams ? formatTwoDecimalTruncated(downGrams.toString()) : "");
    setMeasurementConfirmed(false);
  }

  function updateFulfillmentAllocations(allocations: FulfillAllocation[]) {
    setFulfillmentAllocations(allocations);
    updateFulfillmentMeasurements(allocations);
  }

  function addSelectedFulfillmentBatches() {
    setError("");
    if (!selectedLotIds.length) {
      setError("Select at least one stock batch.");
      return;
    }
    const selectedLots = selectedLotIds.map((selectedId) => lots.find((lot) => lot.id === selectedId));
    if (selectedLots.some((lot) => !lot || lot.status !== "ACTIVE" || Number(lot.ledgerBalanceGrams) <= 0)) {
      setError("One or more selected batches are no longer available. Refresh inventory and try again.");
      return;
    }
    if (fulfillmentAllocations.length + selectedLots.length > 50) {
      setError("A gold release can include no more than 50 stock batches.");
      return;
    }
    updateFulfillmentAllocations([
      ...fulfillmentAllocations,
      ...selectedLots.flatMap((lot) => lot ? [{ lotId: lot.id, grams: String(lot.ledgerBalanceGrams) }] : []),
    ]);
    setSelectedLotIds([]);
  }

  async function submit(action: AdvanceAction) {
    setError("");
    if (!accountId) {
      setError("Create or select an active GHS cash or bank account first.");
      return;
    }
    if (action === "CREATE_ADVANCE" && !customerId) {
      setError("Select a customer before recording an advance.");
      return;
    }
    if (action !== "CREATE_ADVANCE" && !selectedAdvanceId) {
      setError("Select a customer advance.");
      return;
    }
    setBusy(true);
    setPaymentProcessing(true);
    try {
      const requestedGoldInGrams = requestedGrams && requestedGoldUnit === "kg"
        ? new Prisma.Decimal(requestedGrams).mul(1000).toString()
        : requestedGrams;
      const response = await fetch("/api/customer-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "CREATE_ADVANCE" ? { customerId } : { advanceId: selectedAdvanceId }),
          ...(action === "CREATE_ADVANCE" && requestedGoldInGrams ? { requestedGrams: requestedGoldInGrams } : {}),
          amount,
          cashAccountId: accountId,
          method,
          paidAt: new Date(paidAt).toISOString(),
          note,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to record the advance payment"));
      const receiptId = body && typeof body === "object"
        ? action === "CREATE_ADVANCE" && "paymentId" in body && typeof body.paymentId === "string"
          ? body.paymentId
          : "id" in body && typeof body.id === "string" ? body.id : ""
        : "";
      if (!receiptId) throw new Error("The advance was saved, but its receipt could not be opened. Find the transaction in customer advance history.");
      setAmount("");
      setNote("");
      setRequestedGrams("");
      if (action === "CREATE_ADVANCE" && requestedGrams) {
        showToast("Cash advance and requested gold recorded.");
      }
      setGeneratingReceipt(true);
      router.push(`/finance/financing/receipt/${encodeURIComponent(receiptId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record the advance payment");
    } finally {
      setBusy(false);
      setPaymentProcessing(false);
    }
  }

  async function fulfillRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selectedRequest) {
      setError("Select an open customer gold request.");
      return;
    }
    if (!fulfillmentAllocations.length) {
      setError("Add at least one stock batch and its fulfillment weight.");
      return;
    }
    if (fulfillmentAllocations.some((allocation) => Number(allocation.grams) > Number(lots.find((lot) => lot.id === allocation.lotId)?.ledgerBalanceGrams ?? 0))) {
      setError("A fulfillment allocation exceeds its batch’s available stock. Refresh inventory and try again.");
      return;
    }
    if (allocatedFulfillmentGrams > Number(selectedRequest.remainingGrams)) {
      setError("Fulfillment cannot exceed the remaining requested weight.");
      return;
    }
    if (!measurementConfirmed || !measurement.result) {
      setError("Measure the gold and apply the calculated measurement before releasing it.");
      return;
    }
    if (!measurement.result.topGrams.equals(allocatedFulfillmentDecimal)) {
      setError("Top weight measurement must match the total grams allocated from stock batches.");
      return;
    }
    if (!boardPrice) {
      setError("No current GHS price per gram of pure gold is available.");
      return;
    }
    setBusy(true);
    setFulfillmentProcessing(true);
    try {
      const response = await fetch("/api/customer-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "FULFILL",
          requestId: selectedRequest.id,
          transactionDate: new Date(transactionDate).toISOString(),
          purityBps: weightedPurityBps,
          pricePerGram: String(boardPrice.priceAmount),
          topGrams: measurementTopGrams,
          downGrams: measurementDownGrams,
          note,
          allocations: fulfillmentAllocations,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to fulfill the gold request"));
      if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
        throw new Error("The gold request was fulfilled, but its receipt could not be opened. Find the transaction in Sales History.");
      }
      setSelectedLotIds([]);
      setFulfillmentAllocations([]);
      setMeasurementTopGrams("");
      setMeasurementDownGrams("");
      setMeasurementConfirmed(false);
      setNote("");
      setGeneratingReceipt(true);
      router.push(`/sales/receipt/${encodeURIComponent(body.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to fulfill the gold request");
    } finally {
      setBusy(false);
      setFulfillmentProcessing(false);
    }
  }

  return <>
  <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-[#8b949e]">Workspace / Sales</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17212f]">Supplier gold advances</h1>
        <p className="mt-1 text-sm text-[#76808c]">Record customer funds, gold requests, partial releases and the remaining cash credit or amount due.</p>
      </div>
      <RefreshButton loading={loading} onClick={() => { void load(); }} />
    </div>
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
      Gold requests are non-binding: requested but unreleased grams do not create a company debt or change the advance balance. Only gold actually released is deducted; unused cash remains customer credit. Each release uses the current GHS board price per pure gram.
    </div>
    <AlertDialog open={Boolean(error)} title="Customer advance error" description={error} onConfirm={() => setError("")} />

    <div className="grid items-start gap-3 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Record customer cash advance</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <FormField label="Customer" htmlFor="advance-customer"><CustomerAutocomplete id="advance-customer" customers={customers} value={customerId} onChange={setCustomerId} placeholder="Search customers by name or ID" /></FormField>
            {canCreateCustomer && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setError(""); setShowCustomerForm(true); }}><Plus size={14} /> Add new customer</Button>}
          </div>
          <FormField label="Amount received (GHS)" htmlFor="advance-amount"><GhanaAmountInput id="advance-amount" min="0.01" step="0.01" value={amount} onChange={setAmount} className={fieldControlClass} /></FormField>
          <FormField label="Requested gold" htmlFor="advance-requested-grams" hint="Optional. You can also record a request later." className="sm:col-span-2">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] gap-2">
              <input id="advance-requested-grams" type="number" min={requestedGoldUnit === "kg" ? "0.00000001" : "0.00001"} step={requestedGoldUnit === "kg" ? "0.00000001" : "0.00001"} value={requestedGrams} onChange={(event) => setRequestedGrams(event.target.value)} className={`${fieldControlClass} min-w-0`} />
              <select aria-label="Requested gold unit" value={requestedGoldUnit} onChange={(event) => setRequestedGoldUnit(event.target.value as "g" | "kg")} className={fieldControlClass}>
                <option value="g">Grams</option>
                <option value="kg">KG</option>
              </select>
            </div>
          </FormField>
          <PaymentFields idPrefix="new-advance" accountId={accountId} setAccountId={setAccountId} accounts={accounts} method={method} setMethod={setMethod} paidAt={paidAt} setPaidAt={setPaidAt} />
          <FormField label="Note / receipt reference" htmlFor="advance-note"><input id="advance-note" value={note} onChange={(event) => setNote(event.target.value)} className={fieldControlClass} maxLength={500} /></FormField>
          {canWrite && <div className="sm:col-span-2"><Button variant="gold" disabled={busy || loading || !customerId || !amount} onClick={() => { void submit("CREATE_ADVANCE"); }}><WalletCards size={15} /> Record advance</Button></div>}
        </CardContent>
      </Card>

      {showCustomerForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !customerBusy) setShowCustomerForm(false);
      }}>
        <div role="dialog" aria-modal="true" aria-labelledby="advance-new-customer-title" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#e5e8eb] bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div><h2 id="advance-new-customer-title" className="text-lg font-semibold text-[#17212f]">Add Customer</h2><p className="mt-1 text-xs text-[#76808c]">Complete the customer profile. They will be selected for this advance when saved.</p></div>
            <button type="button" aria-label="Close add customer form" disabled={customerBusy} onClick={() => setShowCustomerForm(false)} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50"><X size={18} /></button>
          </div>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { void createCustomer(event); }}>
            <div className="sm:col-span-2"><h3 className="text-sm font-semibold text-[#17212f]">Personal information</h3></div>
            <FormField label="Full name *" htmlFor="advance-new-customer-name"><input id="advance-new-customer-name" required minLength={2} maxLength={120} value={newCustomer.name} onChange={(event) => setNewCustomer((current) => ({ ...current, name: event.target.value }))} className={fieldControlClass} autoComplete="name" /></FormField>
            <FormField label="Customer type" htmlFor="advance-new-customer-type"><select id="advance-new-customer-type" value={newCustomer.type} onChange={(event) => setNewCustomer((current) => ({ ...current, type: event.target.value as CustomerInput["type"] }))} className={fieldControlClass}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></FormField>
            <FormField label="Phone number *" htmlFor="advance-new-customer-phone"><div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#dfe4e9] bg-white shadow-sm"><span className="flex h-full shrink-0 items-center border-r border-[#e8ebef] bg-[#fbfcfe] px-3 text-xs font-medium text-[#465362]">+233</span><input id="advance-new-customer-phone" type="tel" required maxLength={40} value={newCustomer.phone} onChange={(event) => setNewCustomer((current) => ({ ...current, phone: event.target.value }))} className="h-full min-w-0 flex-1 px-3 text-[13px] text-[#263241] outline-none" autoComplete="tel-national" /></div></FormField>
            <FormField label="Alternative phone" htmlFor="advance-new-customer-alt-phone"><input id="advance-new-customer-alt-phone" type="tel" maxLength={500} value={newCustomer.alternativePhone ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, alternativePhone: event.target.value }))} className={fieldControlClass} /></FormField>
            <FormField label="Email address" htmlFor="advance-new-customer-email"><input id="advance-new-customer-email" type="email" maxLength={254} value={newCustomer.email} onChange={(event) => setNewCustomer((current) => ({ ...current, email: event.target.value }))} className={fieldControlClass} autoComplete="email" /></FormField>
            <FormField label="Date of birth *" htmlFor="advance-new-customer-dob"><CalendarPicker id="advance-new-customer-dob" required value={newCustomer.dateOfBirth ?? ""} onChange={(dateOfBirth) => setNewCustomer((current) => ({ ...current, dateOfBirth }))} max={new Date().toISOString().slice(0, 10)} /></FormField>
            <FormField label="Gender" htmlFor="advance-new-customer-gender"><select id="advance-new-customer-gender" value={newCustomer.gender ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, gender: event.target.value as CustomerInput["gender"] }))} className={fieldControlClass}><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></FormField>
            <FormField label="ID type" htmlFor="advance-new-customer-id-type"><select id="advance-new-customer-id-type" value={newCustomer.idType ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, idType: event.target.value as CustomerInput["idType"] }))} className={fieldControlClass}><option value="">Select ID type</option><option value="GHANA_CARD">Ghana Card</option><option value="PASSPORT">Passport</option><option value="DRIVERS_LICENSE">Driver’s license</option><option value="VOTER_ID">Voter ID</option><option value="OTHER">Other</option></select></FormField>
            <FormField label="ID number" htmlFor="advance-new-customer-id-number"><input id="advance-new-customer-id-number" maxLength={500} value={newCustomer.idNumber ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, idNumber: event.target.value }))} className={fieldControlClass} /></FormField>
            <FormField label="TIN" htmlFor="advance-new-customer-tin"><input id="advance-new-customer-tin" maxLength={500} value={newCustomer.tin ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, tin: event.target.value }))} className={fieldControlClass} /></FormField>
            <div className="sm:col-span-2"><h3 className="mt-2 text-sm font-semibold text-[#17212f]">Address information</h3></div>
            <FormField label="Address line 1" htmlFor="advance-new-customer-address1"><input id="advance-new-customer-address1" maxLength={191} value={newCustomer.addressLine1 ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, addressLine1: event.target.value }))} className={fieldControlClass} autoComplete="address-line1" /></FormField>
            <FormField label="Address line 2" htmlFor="advance-new-customer-address2"><input id="advance-new-customer-address2" maxLength={191} value={newCustomer.addressLine2 ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, addressLine2: event.target.value }))} className={fieldControlClass} autoComplete="address-line2" /></FormField>
            <FormField label="City / town" htmlFor="advance-new-customer-city"><input id="advance-new-customer-city" maxLength={120} value={newCustomer.city ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, city: event.target.value }))} className={fieldControlClass} autoComplete="address-level2" /></FormField>
            <FormField label="Region" htmlFor="advance-new-customer-region"><select id="advance-new-customer-region" value={newCustomer.region ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, region: event.target.value }))} className={fieldControlClass}><option value="">Select region</option>{ghanaRegions.map((region) => <option key={region} value={region}>{region}</option>)}</select></FormField>
            <FormField label="Country" htmlFor="advance-new-customer-country"><select id="advance-new-customer-country" value={newCustomer.country ?? "Ghana"} onChange={(event) => setNewCustomer((current) => ({ ...current, country: event.target.value }))} className={fieldControlClass}><option value="Ghana">Ghana</option></select></FormField>
            <FormField label="GPS location" htmlFor="advance-new-customer-gps"><input id="advance-new-customer-gps" maxLength={191} value={newCustomer.gpsLocation ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, gpsLocation: event.target.value }))} className={fieldControlClass} /></FormField>
            <FormField label="Notes" htmlFor="advance-new-customer-notes" className="sm:col-span-2"><textarea id="advance-new-customer-notes" rows={3} maxLength={500} value={newCustomer.notes ?? ""} onChange={(event) => setNewCustomer((current) => ({ ...current, notes: event.target.value }))} className={`${fieldControlClass} h-auto resize-y py-3`} /></FormField>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" disabled={customerBusy} onClick={() => setShowCustomerForm(false)}>Cancel</Button>
              <Button type="submit" variant="gold" disabled={customerBusy}>{customerBusy ? "Saving…" : "Save customer"}</Button>
            </div>
          </form>
        </div>
      </div>}

      <Card>
        <CardHeader><CardTitle>Add funds or refund cash</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField label="Customer advance" htmlFor="advance-ledger"><select id="advance-ledger" value={selectedAdvanceId} onChange={(event) => setSelectedAdvanceId(event.target.value)} className={fieldControlClass}><option value="">Select an advance</option>{advances.map((advance) => <option key={advance.id} value={advance.id}>{advance.customer.name} · {currency(advance.balance)}</option>)}</select></FormField>
          <FormField label="Amount (GHS)" htmlFor="advance-adjust-amount"><GhanaAmountInput id="advance-adjust-amount" min="0.01" step="0.01" value={amount} onChange={setAmount} className={fieldControlClass} /></FormField>
          <PaymentFields idPrefix="adjust-advance" accountId={accountId} setAccountId={setAccountId} accounts={accounts} method={method} setMethod={setMethod} paidAt={paidAt} setPaidAt={setPaidAt} />
          <FormField label="Note / reason" htmlFor="advance-adjust-note"><input id="advance-adjust-note" value={note} onChange={(event) => setNote(event.target.value)} className={fieldControlClass} maxLength={500} /></FormField>
          {canWrite && <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="gold" disabled={busy || loading || !selectedAdvanceId || !amount} onClick={() => { void submit("ADD_FUNDS"); }}>Add funds</Button>
            <Button variant="outline" disabled={busy || loading || !selectedAdvanceId || !amount || Number(selectedAdvance?.balance ?? 0) <= 0} onClick={() => { void submit("REFUND"); }}>Refund available credit</Button>
          </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Fulfill requested gold</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={fulfillRequest}>
            <FormField label="Open gold request" htmlFor="fulfill-request"><select id="fulfill-request" required value={selectedRequestId} onChange={(event) => { setSelectedRequestId(event.target.value); setSelectedLotIds([]); setFulfillmentAllocations([]); setMeasurementTopGrams(""); setMeasurementDownGrams(""); setMeasurementConfirmed(false); }} className={fieldControlClass}><option value="">Select an open request</option>{openRequests.map((request) => <option key={request.id} value={request.id}>{request.customer.name} · {formatWeight(request.remainingGrams, "g", 2)} requested (optional)</option>)}</select></FormField>
            <FormField label="Select stock batches" htmlFor="fulfill-batches"><StockAutocomplete id="fulfill-batches" multiple value={selectedLotIds} onChange={setSelectedLotIds} placeholder="Search and select batches" lots={selectableFulfillmentLots.map((lot): StockOption => ({ id: lot.id, source: lot.source, batchNumber: lot.batchNumber, receivedAt: lot.receivedAt, grams: lot.ledgerBalanceGrams }))} /></FormField>
            <div className="flex items-end"><Button type="button" variant="outline" className="mb-0.5 h-10" disabled={!selectedLotIds.length} onClick={addSelectedFulfillmentBatches}><Plus size={14} /> Add selected batches</Button></div>
            {selectedLotIds.length > 0 && <p className="text-xs text-[#89929d] sm:col-span-2">Selected batches are added with their available weights. Adjust each release amount below if needed.</p>}
            {fulfillmentAllocations.length > 0 && <div className="space-y-1 rounded-md border border-[#edf0f3] p-2 text-xs sm:col-span-2">
              {fulfillmentAllocations.map((allocation) => {
                const lot = lots.find((item) => item.id === allocation.lotId);
                return <div key={allocation.lotId} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2"><span className="truncate">{lot?.source ? `${lot.source} · ` : ""}{lot?.batchNumber ?? "Stock batch"} · {lot ? new Date(lot.receivedAt).toLocaleDateString("en-GH") : ""}</span><div className="flex items-center gap-1"><input aria-label={`Release grams from ${lot?.batchNumber ?? "stock batch"}`} type="number" min="0.00001" max={Number(lot?.ledgerBalanceGrams ?? 0)} step="0.00001" value={allocation.grams} onChange={(event) => updateFulfillmentAllocations(fulfillmentAllocations.map((entry) => entry.lotId === allocation.lotId ? { ...entry, grams: event.target.value } : entry))} className="h-9 min-w-0 flex-1 rounded-md border border-[#dfe4e9] px-2 text-xs outline-none focus:border-[#bc8c36]" /><span className="text-[#89929d]">g</span></div><button type="button" className="text-rose-700 hover:underline" onClick={() => {
                  const next = fulfillmentAllocations.filter((item) => item.lotId !== allocation.lotId);
                  updateFulfillmentAllocations(next);
                }}>Remove</button></div>;
              })}
              <p className="border-t pt-1 font-semibold">Total release: {formatWeight(allocatedFulfillmentGrams, "g", 2)}{selectedRequest ? ` · Remaining request: ${formatWeight(selectedRequest.remainingGrams, "g", 2)}` : ""}</p>
              {selectedRequest && allocatedFulfillmentDecimal.greaterThan(selectedRequest.remainingGrams) && <p role="alert" className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">Reduce the batch amounts to no more than the remaining requested weight.</p>}
            </div>}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#e8ebef] p-3 sm:col-span-2">
              <Button type="button" variant={measurementConfirmed ? "outline" : "gold"} disabled={!boardPrice || !fulfillmentAllocations.length} onClick={() => {
                const allocatedTopGrams = allocatedFulfillmentDecimal.greaterThan(0) ? allocatedFulfillmentDecimal.toString() : "";
                if (measurementTopGrams !== allocatedTopGrams) {
                  setMeasurementTopGrams(allocatedTopGrams);
                  setMeasurementConfirmed(false);
                }
                setMeasurementModalOpen(true);
              }}>{measurementConfirmed ? <><Check size={14} /> Edit gold measurements</> : "Measure gold"}</Button>
              <p className="text-xs text-[#89929d]">{measurementConfirmed && measurement.result
                ? `Applied: ${formatTwoDecimalTruncated(measurement.result.karat.toString())}K · ${currency(measurement.result.total.toFixed(2))}`
                : "Measure the gold to calculate its karat and value against the customer advance."}</p>
            </div>
            <FormField label="Gold purity (karat)" htmlFor="fulfill-purity" hint="Calculated from the gold measurements"><input id="fulfill-purity" type="number" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.karat.toString()) : ""} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
            <FormField label="Current board price (GHS / pure g)" htmlFor="fulfill-price" hint={boardPrice ? `${boardPrice.source} · ${formatDate(boardPrice.effectiveAt)}` : "No compatible published price"}><input id="fulfill-price" readOnly value={boardPrice ? String(boardPrice.priceAmount) : ""} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
            <FormField label="Release date" htmlFor="fulfill-date"><CalendarPicker id="fulfill-date" includeTime max={localDateTime()} required value={transactionDate} onChange={setTransactionDate} /></FormField>
            <FormField label="Gold value at current rate (GHS)" htmlFor="fulfill-value"><input id="fulfill-value" readOnly value={fulfillmentQuote ? currency(fulfillmentQuote) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
            <FormField label="Fulfillment note" htmlFor="fulfill-note"><input id="fulfill-note" value={note} onChange={(event) => setNote(event.target.value)} className={fieldControlClass} maxLength={500} /></FormField>
            {canFulfill && <div className="sm:col-span-2"><Button variant="gold" disabled={busy || loading || !selectedRequest || !fulfillmentAllocations.length || !boardPrice || !fulfillmentQuote}><WalletCards size={15} /> Release gold and deduct advance</Button></div>}
          </form>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle>Customer advance balances and history</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {advances.length === 0 && <p className="py-6 text-center text-sm text-[#89929d]">{loading ? "Loading customer advances…" : "No customer advances have been recorded."}</p>}
        {advances.map((advance) => {
          const balance = Number(advance.balance);
          return <article key={advance.id} className="overflow-hidden rounded-xl border border-[#e8ebef]">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#fafbfc] px-4 py-3">
              <div><p className="text-sm font-semibold text-[#263342]">{advance.customer.name} <span className="font-normal text-[#7b8793]">· {advance.reference}</span></p><p className="mt-1 text-[11px] text-[#788491]">Received {currency(advance.receivedAmount)} · Fulfilled {currency(advance.fulfilledAmount)} · Refunded {currency(advance.refundedAmount)}</p></div>
              <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-[#89929d]">{balance >= 0 ? "Cash credit owed to customer" : "Amount customer owes"}</p><p className={`mt-1 text-base font-bold tabular-nums ${balance < 0 ? "text-rose-700" : "text-[#263342]"}`}>{currency(Math.abs(balance))}</p></div>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#89929d]">Cash activity</h3>
                {advance.payments.length ? <div className="space-y-2">{advance.payments.map((payment) => <div key={payment.reference} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f2f4] pb-2 text-xs"><span className="text-[#586575]">{payment.reference} · {formatDate(payment.paidAt)} · {payment.cashAccount?.name ?? "Account unavailable"}{payment.referencePricePerGram !== null && <span className="block text-[10px] text-[#89929d]">Reference board rate at payment: GHS {payment.referencePricePerGram} / pure g · {payment.referencePriceSource ?? "Board"}{payment.referencePriceEffectiveAt ? ` · ${formatDate(payment.referencePriceEffectiveAt)}` : ""} (not locked)</span>}</span><span className="flex items-center gap-2"><span className={`font-semibold ${payment.direction === "OUTBOUND" ? "text-rose-700" : "text-emerald-700"}`}>{payment.direction === "OUTBOUND" ? "−" : "+"}{currency(payment.amount)}</span><Button asChild size="sm" variant="outline"><Link href={`/finance/financing/receipt/${encodeURIComponent(payment.id)}`}>Receipt</Link></Button></span></div>)}</div> : <p className="text-xs text-[#89929d]">No cash activity.</p>}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#89929d]">Gold requests and releases</h3>
                {advance.requests.length ? <div className="space-y-3">{advance.requests.map((request) => <div key={request.id} className="rounded-lg border border-[#edf0f3] p-3">
                  <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold text-[#344151]">{request.reference}</span><Badge tone={Number(request.remainingGrams) <= 0 ? "green" : request.fulfillments.length ? "gold" : "blue"}>{Number(request.remainingGrams) <= 0 ? "Fulfilled" : request.fulfillments.length ? "Partially fulfilled" : "Open"}</Badge></div>
                  <p className="mt-1 text-[11px] text-[#667382]">Requested {formatWeight(request.requestedGrams, "g", 2)} · Released {formatWeight(request.fulfilledGrams, "g", 2)} · Still requested {formatWeight(request.remainingGrams, "g", 2)} (optional; not a cash balance or debt)</p>
                  {request.fulfillments.map((fulfillment) => <div key={fulfillment.reference} className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#89929d]"><span>{fulfillment.reference}: {formatWeight(fulfillment.grams, "g", 2)} at GHS {fulfillment.pricePerGram}/pure g · {currency(fulfillment.amount)} · {fulfillment.trade.reference}</span><Button asChild size="sm" variant="outline"><Link href={`/sales/receipt/${encodeURIComponent(fulfillment.trade.id)}`}>Receipt</Link></Button></div>)}
                </div>)}</div> : <p className="text-xs text-[#89929d]">No gold requested on this advance.</p>}
              </div>
            </div>
          </article>;
        })}
      </CardContent>
    </Card>
  </div>
  {measurementModalOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setMeasurementModalOpen(false); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="advance-measurement-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.3)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="advance-measurement-title" className="text-xl font-bold tracking-tight text-[#17212f]">Gold measurement</h2><p className="mt-1 text-sm text-[#637083]">Enter the top and down weights. The configured assay formula and current selling board price calculate the value released from the customer advance.</p></div>
        <button type="button" onClick={() => setMeasurementModalOpen(false)} aria-label="Close gold measurement" className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6]"><X size={16} /></button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label="Top weight (g)" htmlFor="advance-measurement-top" hint="Editing this updates the release weight and spreads the allocation across selected batches, up to their available stock.">
          <input id="advance-measurement-top" type="number" min="0.00001" step="0.00001" max="999999.99999999" value={measurementTopGrams} onChange={(event) => { setMeasurementTopGrams(event.target.value); setMeasurementConfirmed(false); }} className={fieldControlClass} />
        </FormField>
        <FormField label="Down weight (g)" htmlFor="advance-measurement-down" hint="Auto-calculated from receiving measurements of the selected batches; partial batches are scaled. You can adjust it if remeasured.">
          <input id="advance-measurement-down" type="number" min="0.01" step="0.01" max="999999.99" value={measurementDownGrams} onChange={(event) => { setMeasurementDownGrams(event.target.value); setMeasurementConfirmed(false); }} className={fieldControlClass} />
        </FormField>
        <FormField label="Pounds (calculated)" htmlFor="advance-measurement-pounds"><input id="advance-measurement-pounds" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.pounds.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
        <FormField label="Density (calculated)" htmlFor="advance-measurement-density"><input id="advance-measurement-density" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.density.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
        <FormField label="Karat (calculated)" htmlFor="advance-measurement-karat"><input id="advance-measurement-karat" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.karat.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
        <FormField label="Purity (calculated)" htmlFor="advance-measurement-purity"><input id="advance-measurement-purity" readOnly value={measurement.result ? `${formatTwoDecimalTruncated(measurement.result.purity.toString())}%` : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
      </div>
      {measurement.error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{measurement.error}</p>}
      {allocationAdjustment.error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{allocationAdjustment.error}</p>}
      <div className="sale-measurement-price mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d6aa42] bg-[#fff7df] p-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#795719]">Calculated gold value</p><p className="mt-1 text-2xl font-bold tabular-nums text-[#17212f]">{measurement.result ? currency(measurement.result.total.toFixed(2)) : "—"}</p><p className="mt-1 text-[10px] text-[#637083]">{boardPrice ? `Selling board price: ${formatPriceAmount(String(boardPrice.priceAmount), "GHS")} per pure gram` : "No compatible selling board price available"}</p></div>
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setMeasurementModalOpen(false)}>Cancel</Button><Button type="button" variant="gold" disabled={!measurement.result || !allocationAdjustment.allocations} onClick={() => {
          if (!measurement.result || !allocationAdjustment.allocations) return;
          setFulfillmentAllocations(allocationAdjustment.allocations);
          setMeasurementTopGrams(measurement.result.topGrams.toFixed(5));
          setMeasurementConfirmed(true);
          setMeasurementModalOpen(false);
        }}><Check size={15} /> Apply measurements</Button></div>
      </div>
    </section>
  </div>}
  <PaymentProcessingOverlay message={generatingReceipt ? "Opening receipt…" : paymentProcessing ? "Recording payment…" : fulfillmentProcessing ? "Recording gold release…" : null} />
  </>;
}

function PaymentFields({
  idPrefix, accountId, setAccountId, accounts, method, setMethod, paidAt, setPaidAt,
}: {
  idPrefix: string;
  accountId: string;
  setAccountId: (value: string) => void;
  accounts: CashAccount[];
  method: (typeof paymentMethods)[number];
  setMethod: (value: (typeof paymentMethods)[number]) => void;
  paidAt: string;
  setPaidAt: (value: string) => void;
}) {
  return <>
    <FormField label="Cash / bank account" htmlFor={`${idPrefix}-account`}><select id={`${idPrefix}-account`} required value={accountId} onChange={(event) => setAccountId(event.target.value)} className={fieldControlClass}><option value="">Select a GHS account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}</select></FormField>
    <FormField label="Payment method" htmlFor={`${idPrefix}-method`}><select id={`${idPrefix}-method`} value={method} onChange={(event) => setMethod(event.target.value as (typeof paymentMethods)[number])} className={fieldControlClass}>{paymentMethods.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></FormField>
    <FormField label="Payment date" htmlFor={`${idPrefix}-paid-at`}><CalendarPicker id={`${idPrefix}-paid-at`} includeTime max={localDateTime()} required value={paidAt} onChange={setPaidAt} /></FormField>
  </>;
}
