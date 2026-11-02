"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Prisma } from "@prisma/client";
import { ArrowDownToLine, CalendarClock, Check, Coins, FileText, MapPin, Plus, Printer, RotateCcw, ShoppingCart, UserRound, WalletCards, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete";
import { StockAutocomplete, type StockOption } from "@/components/ui/stock-autocomplete";
import { PaymentProcessingOverlay } from "@/components/ui/payment-processing-overlay";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { SearchInput } from "@/components/ui/search-input";
import { calculateMeasuredSaleQuote, inferSaleDownWeightFromReceipts } from "@/lib/gold";
import { formatCurrency, formatPriceAmount, formatTwoDecimalTruncated, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { DEFAULT_PURCHASE_FORMULA_RULES, type PurchaseFormulaRules } from "@/lib/purchase-formula";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { useToast } from "@/components/ui/toast-provider";
import { fetchAllCustomers } from "@/lib/customer-client";
import { saleCorrectionSchema, saleSchema } from "@/lib/validation";
import { ZodError } from "zod";

type Buyer = { id: string; name: string; code: string; type: string; phone?: string | null; address?: string | null };
type Lot = { id: string; batchNumber?: string; source?: string; receivedAt: string; status?: string; remainingGrams: string | number; purityBps: number; costPerGram: string | number; density?: string | number | null; trade: { reference: string; customer?: { name: string } | null; purchaseMeasurement?: { topKg: string | number; downKg: string | number } | null } | null };
type Allocation = { lotId: string; grams: string };
type Correction = {
  id: string; reference: string; type: "RETURN" | "REVERSAL"; quantityGrams: string | number;
  creditAmount: string | number; refundAmount: string | number; reason: string; createdAt: string;
  allocations: { lotId: string; grams: string | number }[];
  createdBy: { name: string };
  payments: { reference: string; amount: string | number; direction: string; method: string; paidAt: string }[];
};
type Sale = {
  id: string; reference: string; status: string; saleStatus: "POSTED" | "PARTIALLY_RETURNED" | "RETURNED" | "VOIDED";
  customer: Buyer | null; customerId: string | null; transactionDate: string; quantityKg: string | number;
  purityBps: number; pricePerGram: string | number; totalAmount: string | number; discountAmount: string | number;
  paymentAmount: string | number; paymentMethod: string; note: string | null; createdBy: { name: string };
  returnedGrams: string | number; creditAmount: string | number; refundedAmount: string | number;
  outstandingBalance: string | number; allocations: { lotId: string; grams: string | number; lot: { batchNumber: string; trade: { reference: string } | null } }[];
  payments: { reference: string; amount: string | number; direction: string; method: string }[];
  advanceFulfillment?: { amount: string | number } | null;
  corrections: Correction[];
};
type BoardPrice = { priceType: "RECEIVING" | "SELLING"; priceAmount: string; currency: string; priceUnit: string; effectiveAt: string };
type CashAccount = { id: string; name: string; type: string; currency: string };
type View = "all" | "new" | "history" | "payments" | "returns";
type PendingCorrection = { sale: Sale; payload: { type: "RETURN" | "REVERSAL"; reason: string; allocations?: Allocation[] } } | null;

const localDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const saleDateTime = (value: string) => new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
const paymentMethods = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"];
const statusLabel = (status: Sale["saleStatus"]) => status.replaceAll("_", " ");
const statusTone = (status: Sale["saleStatus"]) => status === "POSTED" ? "green" : status === "PARTIALLY_RETURNED" ? "blue" : status === "VOIDED" ? "red" : "neutral";

export function SalesManagement({ view, canWrite, canDiscount, canCreateBuyer }: {
  view: View; canWrite: boolean; canDiscount: boolean; canCreateBuyer: boolean;
}) {
  const router = useRouter();
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [transactionDate, setTransactionDate] = useState(localDateTime);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedLotGrams, setSelectedLotGrams] = useState("");
  const [measurementTopGrams, setMeasurementTopGrams] = useState("");
  const [measurementDownGrams, setMeasurementDownGrams] = useState("");
  const [measurementConfirmed, setMeasurementConfirmed] = useState(false);
  const [measurementModalOpen, setMeasurementModalOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("0");
  const [initialPayment, setInitialPayment] = useState("0");
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false);
  const [method, setMethod] = useState("CASH");
  const [cashAccountId, setCashAccountId] = useState("");
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [formulaRules, setFormulaRules] = useState<PurchaseFormulaRules>(DEFAULT_PURCHASE_FORMULA_RULES);
  const [note, setNote] = useState("");
  const [boardPrice, setBoardPrice] = useState<BoardPrice | null>(null);
  const pricePerGram = boardPrice ? String(boardPrice.priceAmount) : "";
  const [quickBuyer, setQuickBuyer] = useState(false);
  const [quickBuyerError, setQuickBuyerError] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerType, setBuyerType] = useState("INDIVIDUAL");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [correctionSale, setCorrectionSale] = useState<Sale | null>(null);
  const [returnWeights, setReturnWeights] = useState<Record<string, string>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [pendingCorrection, setPendingCorrection] = useState<PendingCorrection>(null);

  const allocatedGramsDecimal = allocations.reduce((sum, allocation) => sum.plus(allocation.grams || 0), new Prisma.Decimal(0));
  const allocatedGrams = allocatedGramsDecimal.toNumber();
  const quantityKg = allocatedGramsDecimal.div(1000).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN).toFixed(8);
  const measurement = useMemo(() => {
    if (!measurementTopGrams || !measurementDownGrams || !boardPrice) return { result: null, error: "" };
    try {
      return {
        result: calculateMeasuredSaleQuote(measurementTopGrams, measurementDownGrams, pricePerGram, discountAmount, formulaRules),
        error: "",
      };
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : "Check the entered gold measurements" };
    }
  }, [measurementTopGrams, measurementDownGrams, boardPrice, pricePerGram, discountAmount, formulaRules]);
  const weightedPurityBps = measurement.result?.purityBps ?? null;
  const quote = useMemo(() => {
    if (!measurementConfirmed || !allocations.length || !measurement.result
      || !measurement.result.topGrams.equals(allocatedGramsDecimal)) return null;
    return {
      totalGrams: measurement.result.topGrams,
      pureGrams: measurement.result.topGrams.mul(measurement.result.purityBps).div(10000),
      purityBps: measurement.result.purityBps,
      subtotal: measurement.result.subtotal,
      discount: measurement.result.discount,
      total: measurement.result.total,
    };
  }, [measurementConfirmed, allocations.length, measurement.result, allocatedGramsDecimal]);
  const amountPaid = paymentAmountTouched ? initialPayment : quote?.total.toFixed(2) ?? "0.00";
  const selectedBuyer = buyers.find((buyer) => buyer.id === buyerId);
  const selectedLot = lots.find((lot) => lot.id === selectedLotId);
  const availableStockGrams = lots.filter((lot) => lot.status === "ACTIVE").reduce((sum, lot) => sum + Math.max(0, Number(lot.remainingGrams)), 0);
  const saleKarat = measurement.result ? formatTwoDecimalTruncated(measurement.result.karat.toString()) : "—";

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const needsSaleFormData = view === "new";
      const params = new URLSearchParams({ pageSize: needsSaleFormData ? "5" : "500", q: query, status });
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      const [salesResponse, customers, inventoryResponse, boardResponse, accountResponse, formulaResponse] = await Promise.all([
        fetch(`/api/sales?${params}`, { cache: "no-store" }),
        needsSaleFormData ? fetchAllCustomers<Buyer>("BUYER") : Promise.resolve(null),
        needsSaleFormData ? fetch("/api/inventory", { cache: "no-store" }) : Promise.resolve(null),
        needsSaleFormData ? fetch("/api/board-prices", { cache: "no-store" }) : Promise.resolve(null),
        needsSaleFormData ? fetch("/api/finance/accounts", { cache: "no-store" }) : Promise.resolve(null),
        needsSaleFormData ? fetch("/api/receiving/formula", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const [saleBody, inventoryBody, boardBody, accountBody, formulaBody] = await Promise.all([
        salesResponse.json(),
        inventoryResponse?.json() ?? Promise.resolve(null),
        boardResponse?.json() ?? Promise.resolve(null),
        accountResponse?.json() ?? Promise.resolve(null),
        formulaResponse?.json() ?? Promise.resolve(null),
      ]) as [
        { sales?: Sale[]; error?: string },
        { lots?: Lot[]; error?: string } | null,
        BoardPrice[] | { error?: string } | null,
        CashAccount[] | { error?: string } | null,
        PurchaseFormulaRules | { error?: string } | null,
      ];
      if (!salesResponse.ok) throw new Error(saleBody.error || "Could not load sales history");
      if (inventoryResponse && !inventoryResponse.ok) throw new Error(inventoryBody?.error || "Could not load available stock");
      if (boardResponse && !boardResponse.ok) throw new Error(!Array.isArray(boardBody) ? boardBody?.error || "Could not load current board price" : "Could not load current board price");
      if (accountResponse && !accountResponse.ok) throw new Error(!Array.isArray(accountBody) ? accountBody?.error || "Could not load cash accounts" : "Could not load cash accounts");
      if (formulaResponse && !formulaResponse.ok) throw new Error(formulaBody && "error" in formulaBody ? formulaBody.error || "Could not load the sale measurement formula" : "Could not load the sale measurement formula");
      setSales(saleBody.sales ?? []);
      if (customers) setBuyers(customers);
      if (inventoryBody) setLots(inventoryBody.lots ?? []);
      if (accountBody) {
        const activeCashAccounts: CashAccount[] = Array.isArray(accountBody)
          ? accountBody.filter((account) => account.currency === "GHS")
          : [];
        setCashAccounts(activeCashAccounts);
        setCashAccountId((current) => current || activeCashAccounts[0]?.id || "");
      }
      if (formulaBody && "version" in formulaBody) setFormulaRules(formulaBody);
      if (Array.isArray(boardBody)) {
        const now = Date.now();
        const compatible = boardBody.find((price) =>
          price.priceType === "SELLING"
          && price.currency === "GHS"
          && price.priceUnit === "GHS_PER_GRAM_PURE_GOLD"
          && new Date(price.effectiveAt).getTime() <= now,
        );
        setBoardPrice(compatible ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sales workspace");
    } finally {
      setLoading(false);
    }
  }, [from, query, status, to, view]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useAutoRefresh(() => load(true));

  useEffect(() => {
    if (!quickBuyer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setQuickBuyer(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quickBuyer, saving]);

  useEffect(() => {
    if (!measurementModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMeasurementModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [measurementModalOpen]);

  function addSelectedBatch() {
    setError("");
    if (!selectedLot) {
      setError("Select a stock batch.");
      return;
    }
    const grams = Number(selectedLotGrams);
    if (!Number.isFinite(grams) || grams <= 0) {
      setError("Enter a weight greater than zero for the selected batch.");
      return;
    }
    if (grams > Number(selectedLot.remainingGrams)) {
      setError("The selected weight exceeds the batch's available stock.");
      return;
    }
    if (!allocations.some((allocation) => allocation.lotId === selectedLot.id) && allocations.length >= 50) {
      setError("A sale can include no more than 50 stock batches.");
      return;
    }
    const remaining = allocations.filter((allocation) => allocation.lotId !== selectedLot.id);
    updateAllocations([...remaining, { lotId: selectedLot.id, grams: selectedLotGrams }]);
    setSelectedLotGrams("");
  }

  function updateAllocations(next: Allocation[]) {
    setAllocations(next);
    const totalGrams = next.reduce((sum, allocation) => sum.plus(allocation.grams || 0), new Prisma.Decimal(0));
    setMeasurementTopGrams(totalGrams.isZero() ? "" : totalGrams.toString());
    const downGrams = inferSaleDownWeightFromReceipts(
      next,
      lots.map((lot) => ({ id: lot.id, purchaseMeasurement: lot.trade?.purchaseMeasurement })),
    );
    setMeasurementDownGrams(downGrams?.toString() ?? "");
    setMeasurementConfirmed(false);
  }

  function clearSale() {
    setBuyerId("");
    updateAllocations([]);
    setSelectedLotId("");
    setSelectedLotGrams("");
    setDiscountAmount("0");
    setInitialPayment("0");
    setPaymentAmountTouched(false);
    setMethod("CASH");
    setCashAccountId(cashAccounts[0]?.id ?? "");
    setNote("");
    setError("");
  }

  async function saveSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (allocations.length === 0) {
      setError("Select at least one available stock batch.");
      return;
    }
    if (!measurement.result || !measurementConfirmed) {
      setError("Open the gold measurement modal, enter the measurements, and apply them before completing the sale.");
      return;
    }
    if (!measurement.result.topGrams.equals(allocatedGramsDecimal)) {
      setError("Top weight measurement must match the total grams allocated from stock batches.");
      return;
    }
    if (!canDiscount && Number(discountAmount) > 0) {
      setError("You do not have permission to apply a sales discount.");
      return;
    }
    if (Number(amountPaid) > 0 && cashAccounts.length === 0) {
      setError("No GHS cash account is configured. Set Amount paid to 0 to record this as unpaid, or add a GHS account in Finance before recording a payment.");
      return;
    }
    setSaving(true);
    setGeneratingReceipt(true);
    let navigatingToReceipt = false;
    try {
      const payload = saleSchema.parse({
        customerId: buyerId,
        transactionDate: new Date(transactionDate).toISOString(),
        quantityKg,
        purityBps: weightedPurityBps,
        pricePerGram,
        topGrams: measurementTopGrams,
        downGrams: measurementDownGrams,
        discountAmount,
        initialPayment: amountPaid,
        cashAccountId,
        method,
        note,
        allocations,
      });
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { id?: string; reference?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not complete sale");
      if (!body.id) throw new Error(`Sale ${body.reference ?? ""} was saved, but its receipt could not be opened. Find the sale in Sales History.`);
      showToast(`Sale ${body.reference} completed. Receipt generated.`);
      navigatingToReceipt = true;
      router.push(`/sales/receipt/${encodeURIComponent(body.id)}`);
    } catch (cause) {
      setError(cause instanceof ZodError ? cause.issues[0]?.message ?? "Check the sale details" : cause instanceof Error ? cause.message : "Could not complete sale");
    } finally {
      if (!navigatingToReceipt) {
        setSaving(false);
        setGeneratingReceipt(false);
      }
    }
  }

  async function createBuyer() {
    setQuickBuyerError("");
    setSaving(true);
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: buyerName, kind: "BUYER", type: buyerType, phone: buyerPhone }),
      });
      const body = await response.json() as Buyer & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create buyer");
      setBuyers((existing) => [body, ...existing]);
      setBuyerId(body.id);
      setQuickBuyer(false);
      setBuyerName("");
      setBuyerType("INDIVIDUAL");
      setBuyerPhone("");
    } catch (cause) {
      setQuickBuyerError(cause instanceof Error ? cause.message : "Could not create buyer");
    } finally {
      setSaving(false);
    }
  }

  function requestReturn(sale: Sale) {
    setCorrectionSale(sale);
    setReturnWeights({});
    setCorrectionReason("");
  }

  function startCorrection(type: "RETURN" | "REVERSAL") {
    if (!correctionSale) return;
    const payload = type === "REVERSAL"
      ? { type, reason: correctionReason }
      : {
        type,
        reason: correctionReason,
        allocations: Object.entries(returnWeights)
          .filter(([, grams]) => Number(grams) > 0)
          .map(([lotId, grams]) => ({ lotId, grams })),
      };
    const checked = saleCorrectionSchema.safeParse(payload);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message || "Check the return details");
      return;
    }
    setPendingCorrection({ sale: correctionSale, payload: checked.data });
  }

  async function submitCorrection() {
    if (!pendingCorrection) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/sales/${pendingCorrection.sale.id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingCorrection.payload),
      });
      const body = await response.json() as { reference?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not record sale correction");
      showToast(`Correction ${body.reference} recorded. Stock, refund, and audit records were updated.`);
      setCorrectionSale(null);
      setPendingCorrection(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record sale correction");
      setPendingCorrection(null);
    } finally {
      setSaving(false);
    }
  }

  const exportHref = `/api/sales/export?${new URLSearchParams({
    q: query, status,
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
  }).toString()}`;
  const pageTitle = view === "new" ? "New Sale" : view === "returns" ? "Sales returns and reversals" : view === "payments" ? "Sales payments" : view === "history" ? "Sales history" : "All sales";

  return <>
  <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium text-[#8b949e]">Sales management</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{pageTitle}</h1><p className="mt-1.5 text-sm text-[#76808c]">{view === "new" ? "Create a sale, allocate available gold stock, and record payment details." : "Batch-aware sales with atomic stock issues, payments, receipts, and audited corrections."}</p></div>
      <div className="flex flex-wrap gap-2">
        <RefreshButton loading={loading} onClick={() => { void load(); }} />
        {view !== "new" && <Button asChild variant="outline" size="sm"><a href={exportHref}><ArrowDownToLine size={14} /> Export CSV</a></Button>}
        {view !== "new" && canWrite && <Button asChild variant="gold" size="sm"><Link href="/sales/new-sale"><Plus size={14} /> New sale</Link></Button>}
      </div>
    </div>
    <AlertDialog open={Boolean(error)} title="Sales error" description={error} onConfirm={() => setError("")} />

    {view === "new" && <form onSubmit={saveSale} className="space-y-6">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.9fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#f5e3b0] text-[#795719]"><UserRound size={16} /></span><CardTitle>Customer Information</CardTitle></div></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <FormField label="Customer" htmlFor="sale-buyer"><CustomerAutocomplete id="sale-buyer" customers={buyers} value={buyerId} onChange={setBuyerId} placeholder="Search customer or choose walk-in" /></FormField>
                {canCreateBuyer && <Button type="button" variant="gold" size="sm" className="h-10" onClick={() => { setQuickBuyerError(""); setQuickBuyer(true); }}><Plus size={14} /> Quick-create buyer</Button>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Sale date and time" htmlFor="sale-date"><CalendarPicker id="sale-date" includeTime max={localDateTime()} value={transactionDate} onChange={setTransactionDate} required /></FormField>
                <div className="flex items-end text-xs text-[#7d8792]"><CalendarClock size={15} className="mr-2 mb-2.5 text-[#a97520]" />This sale is recorded with the selected date and time.</div>
              </div>
              {selectedBuyer && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d6aa42] bg-[#fff0c2] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#f4e6c7] text-sm font-semibold text-[#8a611c]">{selectedBuyer.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#293442]">{selectedBuyer.name}</p><p className="mt-1 text-xs text-[#7d8792]">{selectedBuyer.code} · {selectedBuyer.type.toLowerCase()}{selectedBuyer.phone ? ` · ${selectedBuyer.phone}` : ""}</p>{selectedBuyer.address && <p className="mt-1 flex items-center gap-1 text-xs text-[#7d8792]"><MapPin size={12} />{selectedBuyer.address}</p>}</div>
                </div>
                <Link href={`/customers/${selectedBuyer.id}`} className="text-xs font-semibold text-[#9a6a1d] hover:underline">View customer</Link>
              </div>}
              {!selectedBuyer && <p className="text-xs text-[#89929d]">Select a customer to attach this sale to their account, or continue as a walk-in buyer.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#f5e3b0] text-[#795719]"><Coins size={16} /></span><CardTitle>Gold Details</CardTitle></div><p className="text-xs text-[#89929d]">Available stock: {formatWeight(availableStockGrams, "g", 2)}</p></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Stock batch" htmlFor="sale-batch"><StockAutocomplete id="sale-batch" value={selectedLotId} onChange={setSelectedLotId} placeholder="Search available batches" lots={lots.filter((lot) => lot.status === "ACTIVE" && Number(lot.remainingGrams) > 0).map((lot): StockOption => ({ id: lot.id, source: lot.source || lot.trade?.customer?.name || "Unknown source", batchNumber: lot.batchNumber || lot.trade?.reference || "Unnumbered batch", receivedAt: lot.receivedAt, grams: lot.remainingGrams }))} /></FormField>
                <div className="flex items-end gap-2"><FormField label="Batch weight (grams)" htmlFor="sale-batch-grams"><input id="sale-batch-grams" type="number" min="0.00001" max={selectedLot ? Number(selectedLot.remainingGrams) : undefined} step="0.00001" value={selectedLotGrams} onChange={(event) => setSelectedLotGrams(event.target.value)} className={fieldControlClass} placeholder="Enter grams" /></FormField><Button type="button" variant="outline" className="mb-0.5 h-10 shrink-0" disabled={!selectedLot || !selectedLotGrams} onClick={addSelectedBatch}><Plus size={14} /> Add batch</Button></div>
              </div>
              {allocations.length > 0 ? <div className="space-y-2 rounded-lg border border-[#edf0f3] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#89929d]">Allocated batches</p>
                {allocations.map((allocation) => {
                  const lot = lots.find((item) => item.id === allocation.lotId);
                  const label = lot?.batchNumber || lot?.trade?.reference || "Stock batch";
                  return <div key={allocation.lotId} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2 text-xs">
                    <span className="truncate font-medium text-[#344151]">{label}<span className="ml-2 font-normal text-[#89929d]">{formatWeight(lot?.remainingGrams ?? 0, "g", 2)} available</span></span>
                    <input aria-label={`Allocated grams from ${label}`} type="number" min="0" max={Number(lot?.remainingGrams ?? 0)} step="0.00001" value={allocation.grams} onChange={(event) => updateAllocations(allocations.map((entry) => entry.lotId === allocation.lotId ? { ...entry, grams: event.target.value } : entry))} className="h-9 rounded-md border border-[#dfe4e9] px-2 text-xs outline-none focus:border-[#bc8c36]" />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label}`} onClick={() => updateAllocations(allocations.filter((entry) => entry.lotId !== allocation.lotId))}><X size={14} /></Button>
                  </div>;
                })}
              </div> : <p className="rounded-lg bg-[#fafbfc] p-3 text-xs text-[#89929d]">{lots.some((lot) => lot.status === "ACTIVE" && Number(lot.remainingGrams) > 0) ? "Choose a batch and enter its weight to add stock to this sale." : "No available gold stock."}</p>}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#e8ebef] p-3">
                <Button type="button" variant={measurementConfirmed ? "outline" : "gold"} disabled={!boardPrice} onClick={() => setMeasurementModalOpen(true)}>{measurementConfirmed ? <><Check size={14} /> Edit gold measurements</> : "Measure gold"}</Button>
                <p className="text-xs text-[#89929d]">{measurementConfirmed && measurement.result
                  ? `Applied: ${formatTwoDecimalTruncated(measurement.result.karat.toString())}K · ${formatCurrency(measurement.result.total.toNumber())}`
                  : "Measure the gold to calculate its karat and sale price."}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Product weight" htmlFor="sale-weight-kg"><input id="sale-weight-kg" readOnly value={formatWeight(allocatedGrams / 1000)} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
                <FormField label="Weight (Pounds)" htmlFor="sale-weight-lb"><input id="sale-weight-lb" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.pounds.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
                <FormField label="Karat (gold measurement)" htmlFor="sale-purity"><input id="sale-purity" readOnly value={saleKarat} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
                <FormField label="Gold price (GHS / pure gram)" htmlFor="sale-rate" hint={boardPrice ? `Fixed to the current selling board price. Administrators can update it from Gold Prices.` : "No compatible selling board price is configured."}><input id="sale-rate" readOnly value={boardPrice ? formatPriceAmount(pricePerGram, boardPrice.currency) : "No compatible board price"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
                <FormField label="Weight (grams)" htmlFor="sale-weight-grams"><input id="sale-weight-grams" readOnly value={formatDecimalTruncated(allocatedGrams, 2)} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
                <FormField label="Density (gold measurement)" htmlFor="sale-density"><input id="sale-density" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.density.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#f5e3b0] text-[#795719]"><WalletCards size={16} /></span><CardTitle>Payment Information</CardTitle></div></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Payment method" htmlFor="sale-method"><select id="sale-method" value={method} onChange={(event) => setMethod(event.target.value)} className={fieldControlClass}>{paymentMethods.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></FormField>
              <FormField label="Cash / bank account" htmlFor="sale-account" hint={cashAccounts.length ? "Required when an amount is paid." : "No GHS cash accounts are available."}><select id="sale-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)} className={fieldControlClass}>{cashAccounts.length === 0 && <option value="" disabled>No GHS cash accounts available</option>}{cashAccounts.filter((account) => account.currency === "GHS").map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}</select></FormField>
              <FormField label="Amount paid (GHS)" htmlFor="sale-paid" hint={cashAccounts.length ? "Defaults to the full sale total; edit it to match the amount actually received." : "Defaults to the full sale total. A GHS cash account is required to record this payment; set to 0 to record as unpaid, or add an account in Finance."}><GhanaAmountInput id="sale-paid" min="0" step="0.01" required value={amountPaid} onChange={(value) => { setPaymentAmountTouched(true); setInitialPayment(value); }} onBlur={() => { if (!initialPayment.trim()) { setPaymentAmountTouched(false); setInitialPayment("0"); } }} className={fieldControlClass} /></FormField>
              <FormField label="Outstanding (GHS)" htmlFor="sale-outstanding"><input id="sale-outstanding" readOnly value={formatCurrency(Math.max(0, (quote?.total.toNumber() ?? 0) - Number(amountPaid || 0)))} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
              {canDiscount && <FormField label="Discount (GHS)" htmlFor="sale-discount"><GhanaAmountInput id="sale-discount" min="0" step="0.01" value={discountAmount} onChange={setDiscountAmount} className={fieldControlClass} /></FormField>}
              {!canDiscount && <p className="self-center text-[11px] text-[#89929d]">Discounts require manager or owner permission.</p>}
              <div className="sm:col-span-2"><FormField label="Sale notes" htmlFor="sale-notes"><textarea id="sale-notes" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={`${fieldControlClass} min-h-20 resize-y`} placeholder="Optional notes" /></FormField></div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-5">
          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#f5e3b0] text-[#795719]"><ShoppingCart size={16} /></span><CardTitle>Sale Summary</CardTitle></div></CardHeader>
            <CardContent>
              <div className="space-y-3 text-xs">
                <SummaryRow label="Weight" value={formatWeight(allocatedGrams / 1000)} />
                <SummaryRow label="Weight in pounds" value={measurement.result ? `${formatTwoDecimalTruncated(measurement.result.pounds.toString())} lb` : "—"} />
                <SummaryRow label="Karat" value={`${saleKarat}K`} />
                <SummaryRow label="Gold price" value={pricePerGram ? `${formatPriceAmount(pricePerGram, "GHS")} / g` : "—"} />
                {quote && quote.discount.toNumber() > 0 && <SummaryRow label="Discount" value={`-${formatCurrency(quote.discount.toNumber())}`} />}
              </div>
              <div className="my-4 border-t border-dashed border-[#e3e7eb]" />
              <div className="flex items-end justify-between gap-3"><span className="text-sm font-semibold text-[#293442]">Total amount</span><span className="text-xl font-bold text-[#9a6a1d]">{quote ? formatCurrency(quote.total.toNumber()) : "—"}</span></div>
              <p className="mt-2 text-right text-[10px] text-[#89929d]">GHS per pure gram · {allocations.length} batch{allocations.length === 1 ? "" : "es"}</p>
              <div className="mt-5 flex flex-col gap-2">
                <Button type="submit" variant="gold" className="w-full" disabled={!canWrite || saving || loading || !quote || allocations.length === 0}>{saving ? "Completing sale…" : "Complete sale"}</Button>
                <Button type="button" variant="outline" className="w-full" onClick={clearSale}>Clear sale</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#f5e3b0] text-[#795719]"><FileText size={16} /></span><CardTitle>Sale Breakdown</CardTitle></div></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <SummaryRow label="Pure weight" value={quote ? `${quote.pureGrams.toFixed(5)} g` : "—"} />
              <SummaryRow label="Subtotal" value={quote ? formatCurrency(quote.subtotal.toNumber()) : "—"} />
              <SummaryRow label="Amount paid" value={formatCurrency(Number(amountPaid || 0))} />
              <SummaryRow label="Balance due" value={quote ? formatCurrency(Math.max(0, quote.total.toNumber() - Number(amountPaid || 0))) : "—"} />
            </CardContent>
          </Card>
        </aside>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between"><div><CardTitle>Recent Sales</CardTitle><p className="mt-1 text-xs text-[#89929d]">Latest completed transactions</p></div><Link href="/sales/all-sales" className="text-xs font-semibold text-[#9a6a1d] hover:underline">View all sales</Link></CardHeader>
        <CardContent>
          {sales.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead><tr className="border-b text-[10px] uppercase text-[#929ba6]"><th className="py-3 pr-3">Sale reference</th><th className="py-3 pr-3">Customer</th><th className="py-3 pr-3">Date</th><th className="py-3 pr-3">Weight</th><th className="py-3 pr-3">Payment</th><th className="py-3">Status</th></tr></thead><tbody>{sales.slice(0, 5).map((sale) => <tr key={sale.id} className="border-b border-[#f0f2f4]"><td className="py-3 pr-3 font-semibold text-[#9a6a1d]"><Link href={`/sales/receipt/${sale.id}`} className="hover:underline">{sale.reference}</Link></td><td className="py-3 pr-3">{sale.customer?.name ?? "Walk-in"}</td><td className="py-3 pr-3">{saleDateTime(sale.transactionDate)}</td><td className="py-3 pr-3">{formatWeight(sale.quantityKg)}</td><td className="py-3 pr-3">{formatCurrency(Number(sale.paymentAmount))}</td><td className="py-3"><Badge tone={statusTone(sale.saleStatus)}>{statusLabel(sale.saleStatus)}</Badge></td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-xs text-[#89929d]">{loading ? "Loading recent sales…" : "No sales recorded yet."}</p>}
        </CardContent>
      </Card>
    </form>}

    {view !== "new" && <Card>
      <CardHeader className="flex-col items-start gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><CardTitle>{view === "returns" ? "Completed sales eligible for correction" : view === "payments" ? "Sales payment ledger" : "Sales history"}</CardTitle><p className="mt-1 text-[11px] text-[#89929d]">{loading ? "Loading sales…" : `${sales.length} sales shown`}</p></div>
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-4">
          <SearchInput value={query} onChange={setQuery} className="w-full xl:w-52" />
          <select aria-label="Filter by sale status" value={status} onChange={(event) => setStatus(event.target.value)} className={`${fieldControlClass}`}><option value="ALL">All statuses</option><option value="POSTED">Posted</option><option value="PARTIALLY_RETURNED">Partially returned</option><option value="RETURNED">Returned</option><option value="VOIDED">Reversed</option></select>
          <CalendarPicker id="sales-from-date" ariaLabel="From date" value={from} onChange={setFrom} className="!h-9 !pl-3 !pr-10 !text-xs" />
          <CalendarPicker id="sales-to-date" ariaLabel="To date" value={to} onChange={setTo} min={from} max={new Date().toISOString().slice(0, 10)} className="!h-9 !pl-3 !pr-10 !text-xs" />
        </div>
      </CardHeader>
      <CardContent>
        {view === "payments" ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr className="border-b text-[10px] uppercase text-[#929ba6]"><th className="py-3 pr-3">Date</th><th className="py-3 pr-3">Payment reference</th><th className="py-3 pr-3">Sale</th><th className="py-3 pr-3">Direction</th><th className="py-3 pr-3">Amount</th><th className="py-3 pr-3">Method</th></tr></thead><tbody>{sales.flatMap((sale) => [
          ...sale.payments.map((payment) => ({ sale, payment })),
          ...sale.corrections.flatMap((correction) => correction.payments.map((payment) => ({ sale, payment }))),
        ]).sort((a, b) => b.payment.reference.localeCompare(a.payment.reference)).map(({ sale, payment }) => <tr key={payment.reference} className="border-b border-[#f0f2f4]"><td className="py-3 pr-3">{saleDateTime(sale.transactionDate)}</td><td className="py-3 pr-3">{payment.reference}</td><td className="py-3 pr-3"><Link className="text-[#9a6a1d] hover:underline" href={`/sales/receipt/${sale.id}`}>{sale.reference}</Link></td><td className="py-3 pr-3">{payment.direction}</td><td className="py-3 pr-3 font-semibold">{formatCurrency(Number(payment.amount))}</td><td className="py-3 pr-3">{payment.method.replaceAll("_", " ")}</td></tr>)}</tbody></table></div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead><tr className="border-b text-[10px] uppercase text-[#929ba6]"><th className="py-3 pr-3">Reference / date</th><th className="py-3 pr-3">Buyer</th><th className="py-3 pr-3">Weight / purity</th><th className="py-3 pr-3">Rate / pure g</th><th className="py-3 pr-3">Discount</th><th className="py-3 pr-3">Sale total</th><th className="py-3 pr-3">Paid / balance</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3">Completed by</th><th className="py-3">Actions</th></tr></thead><tbody>
            {sales.filter((sale) => view !== "returns" || (sale.saleStatus !== "VOIDED" && sale.saleStatus !== "RETURNED")).map((sale) => <tr key={sale.id} className="border-b border-[#f0f2f4] align-middle">
              <td className="py-3 pr-3"><Link href={`/sales/receipt/${sale.id}`} className="font-semibold text-[#9a6a1d] hover:underline">{sale.reference}</Link><p className="mt-1 text-[10px] text-[#929ba6]">{saleDateTime(sale.transactionDate)}</p></td>
              <td className="py-3 pr-3">{sale.customer?.name ?? "Walk-in"}{sale.customer && <p className="mt-1 text-[10px] text-[#929ba6]">{sale.customer.code}</p>}</td>
              <td className="py-3 pr-3">{formatWeight(sale.quantityKg)}<p className="mt-1 text-[10px] text-[#929ba6]">{formatDecimalTruncated(sale.purityBps / 100, 2)}%</p></td>
              <td className="py-3 pr-3">{formatCurrency(Number(sale.pricePerGram))}</td>
              <td className="py-3 pr-3">{formatCurrency(Number(sale.discountAmount))}</td>
              <td className="py-3 pr-3 font-semibold">{formatCurrency(Number(sale.totalAmount) - Number(sale.creditAmount))}</td>
              <td className="py-3 pr-3">{formatCurrency(sale.payments.filter((payment) => payment.direction === "INBOUND").reduce((sum, payment) => sum + Number(payment.amount), 0) + Number(sale.advanceFulfillment?.amount ?? 0) - Number(sale.refundedAmount))}<p className="mt-1 text-[10px] text-[#929ba6]">Due {formatCurrency(Number(sale.outstandingBalance))}</p></td>
              <td className="py-3 pr-3"><Badge tone={statusTone(sale.saleStatus)}>{statusLabel(sale.saleStatus)}</Badge></td>
              <td className="py-3 pr-3">{sale.createdBy.name}</td>
              <td className="py-3"><div className="flex gap-1"><Button asChild size="sm" variant="outline"><Link aria-label={`Print receipt ${sale.reference}`} href={`/sales/receipt/${sale.id}`}><Printer size={13} /></Link></Button>{canWrite && sale.saleStatus !== "VOIDED" && sale.saleStatus !== "RETURNED" && <Button size="sm" variant="outline" onClick={() => requestReturn(sale)} aria-label={`Return or reverse ${sale.reference}`}><RotateCcw size={13} /></Button>}</div></td>
            </tr>)}
            {!loading && sales.length === 0 && <tr><td colSpan={10} className="py-12 text-center text-[#929ba6]">No sales match the selected filters.</td></tr>}
          </tbody></table></div>}
      </CardContent>
    </Card>}

    {measurementModalOpen && view === "new" && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setMeasurementModalOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="sale-measurement-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.3)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="sale-measurement-title" className="text-xl font-bold tracking-tight text-[#17212f]">Gold measurement</h2><p className="mt-1 text-sm text-[#637083]">Enter the top and down weights. The configured assay formula and current selling board price calculate the sale value.</p></div>
          <button type="button" onClick={() => setMeasurementModalOpen(false)} aria-label="Close gold measurement" className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6]"><X size={16} /></button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Top weight (g)" htmlFor="sale-measurement-top" hint="Must match the total grams allocated from stock batches.">
            <input id="sale-measurement-top" type="number" min="0.00001" step="0.00001" max="999999.99999999" value={measurementTopGrams} onChange={(event) => { setMeasurementTopGrams(event.target.value); setMeasurementConfirmed(false); }} className={fieldControlClass} />
          </FormField>
          <FormField label="Down weight (g)" htmlFor="sale-measurement-down" hint="Auto-filled from the receiving measurements of selected batches; partial batches are scaled. You can adjust it if you remeasure.">
            <input id="sale-measurement-down" type="number" min="0.00001" step="0.00001" max="999999.99999999" value={measurementDownGrams} onChange={(event) => { setMeasurementDownGrams(event.target.value); setMeasurementConfirmed(false); }} className={fieldControlClass} />
          </FormField>
          <FormField label="Pounds (calculated)" htmlFor="sale-measurement-pounds"><input id="sale-measurement-pounds" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.pounds.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
          <FormField label="Density (calculated)" htmlFor="sale-measurement-density"><input id="sale-measurement-density" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.density.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
          <FormField label="Karat (calculated)" htmlFor="sale-measurement-karat"><input id="sale-measurement-karat" readOnly value={measurement.result ? formatTwoDecimalTruncated(measurement.result.karat.toString()) : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
          <FormField label="Purity (calculated)" htmlFor="sale-measurement-purity"><input id="sale-measurement-purity" readOnly value={measurement.result ? `${formatTwoDecimalTruncated(measurement.result.purity.toString())}%` : "—"} className={`${fieldControlClass} bg-[#f7f8fa]`} /></FormField>
        </div>
        {measurement.error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{measurement.error}</p>}
        {measurement.result && !measurement.result.topGrams.equals(allocatedGramsDecimal) && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Measured top weight ({formatWeight(measurement.result.topGrams.toString(), "g", 5)}) must exactly match the allocated stock weight ({formatWeight(allocatedGramsDecimal.toString(), "g", 5)}).</p>}
        <div className="sale-measurement-price mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d6aa42] bg-[#fff7df] p-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#795719]">Calculated sale price</p><p className="mt-1 text-2xl font-bold tabular-nums text-[#17212f]">{measurement.result ? formatCurrency(measurement.result.total.toNumber()) : "—"}</p><p className="mt-1 text-[10px] text-[#637083]">{boardPrice ? `Selling board price: ${formatPriceAmount(pricePerGram, "GHS")} per pure gram` : "No compatible selling board price available"}</p></div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setMeasurementModalOpen(false)}>Cancel</Button><Button type="button" variant="gold" disabled={!measurement.result || !allocations.length || !measurement.result.topGrams.equals(allocatedGramsDecimal)} onClick={() => { setMeasurementConfirmed(true); setMeasurementModalOpen(false); }}><Check size={15} /> Apply measurements</Button></div>
        </div>
      </section>
    </div>}

    {quickBuyer && canCreateBuyer && view === "new" && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setQuickBuyer(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="quick-buyer-title" className="w-full max-w-lg rounded-2xl border border-[#e8ebef] bg-[#fbfcfe] p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="quick-buyer-title" className="text-xl font-bold tracking-tight text-[#17212f]">Quick-create buyer</h2><p className="mt-1 text-sm text-[#637083]">Add and select a buyer without losing your sale details.</p></div>
          <button type="button" onClick={() => setQuickBuyer(false)} aria-label="Close quick-create buyer" disabled={saving} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50"><X size={16} /></button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Buyer name" htmlFor="quick-buyer-name" className="sm:col-span-2"><input id="quick-buyer-name" minLength={2} required autoFocus value={buyerName} onChange={(event) => setBuyerName(event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Buyer type" htmlFor="quick-buyer-type"><select id="quick-buyer-type" value={buyerType} onChange={(event) => setBuyerType(event.target.value)} className={fieldControlClass}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></FormField>
          <FormField label="Phone (optional)" htmlFor="quick-buyer-phone"><input id="quick-buyer-phone" type="tel" autoComplete="tel" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} className={fieldControlClass} /></FormField>
        </div>
        <AlertDialog open={Boolean(quickBuyerError)} title="Customer error" description={quickBuyerError} onConfirm={() => setQuickBuyerError("")} />
        <div className="mt-6 flex justify-between gap-2 border-t border-[#e8edf3] pt-4">
          <Button type="button" variant="outline" disabled={saving} onClick={() => setQuickBuyer(false)}><X size={15} /> Cancel</Button>
          <Button type="button" variant="gold" disabled={saving || buyerName.trim().length < 2} onClick={() => { void createBuyer(); }}>{saving ? "Creating…" : <><Plus size={15} /> Create and select buyer</>}</Button>
        </div>
      </section>
    </div>}

    {correctionSale && <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="flex-row items-start justify-between"><div><CardTitle>Return or reverse {correctionSale.reference}</CardTitle><p className="mt-1 text-[11px] text-[#89929d]">Returned quantities are limited to batches sold in this sale. The stock update, financial correction, refund, and audit record commit atomically.</p></div><button aria-label="Close correction form" onClick={() => setCorrectionSale(null)}><X size={16} /></button></CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead><tr className="border-b text-[10px] uppercase text-[#929ba6]"><th className="py-2 pr-3">Sold batch</th><th className="py-2 pr-3">Sold grams</th><th className="py-2 pr-3">Already returned</th><th className="py-2 pr-3">Remaining refundable</th><th className="py-2">Return grams</th></tr></thead><tbody>
          {correctionSale.allocations.map((allocation) => {
            const alreadyReturned = correctionSale.corrections.flatMap((correction) => correction.allocations).filter((entry) => entry.lotId === allocation.lotId).reduce((sum, entry) => sum + Number(entry.grams), 0);
            const stillSold = Math.max(0, Number(allocation.grams) - alreadyReturned);
            return <tr key={allocation.lotId} className="border-b border-amber-100"><td className="py-2 pr-3">{allocation.lot.batchNumber || allocation.lot.trade?.reference || "Unnumbered batch"}</td><td className="py-2 pr-3">{formatDecimalTruncated(allocation.grams, 5)} g</td><td className="py-2 pr-3">{formatDecimalTruncated(alreadyReturned, 5)} g</td><td className="py-2 pr-3">{formatDecimalTruncated(stillSold, 5)} g</td><td className="py-2"><input aria-label={`Return grams from ${allocation.lot.batchNumber || allocation.lot.trade?.reference || allocation.lotId}`} type="number" min="0" max={stillSold} step="0.00001" value={returnWeights[allocation.lotId] ?? ""} onChange={(event) => setReturnWeights((current) => ({ ...current, [allocation.lotId]: event.target.value }))} className="h-8 w-32 rounded border border-[#e5dcc9] bg-white px-2" /></td></tr>;
          })}
        </tbody></table></div>
        <FormField label="Reason for return or reversal" htmlFor="correction-reason"><textarea id="correction-reason" minLength={5} maxLength={500} required value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} className={`${fieldControlClass} h-20 py-2`} placeholder="Explain the customer return or correction" /></FormField>
        <div className="flex flex-wrap gap-2"><Button variant="gold" onClick={() => startCorrection("RETURN")} disabled={saving}>Review return</Button><Button variant="danger" onClick={() => startCorrection("REVERSAL")} disabled={saving || correctionSale.corrections.length > 0}>Review full reversal</Button></div>
        {correctionSale.corrections.length > 0 && <AlertDialog open title="Full reversal unavailable" variant="warning" description="A full reversal is disabled because prior corrections exist. Return the remaining quantities batch by batch." onConfirm={() => {}} />}
      </CardContent>
    </Card>}

    <ConfirmDialog
      open={Boolean(pendingCorrection)}
      title={pendingCorrection?.payload.type === "REVERSAL" ? "Confirm full sale reversal" : "Confirm sale return"}
      description={pendingCorrection ? `${pendingCorrection.payload.type === "REVERSAL" ? "Reverse" : "Return"} ${pendingCorrection.sale.reference} for the recorded reason. This will restore batch stock and create the applicable financial credit/refund and audit entries. This correction cannot be erased.` : ""}
      confirmLabel={pendingCorrection?.payload.type === "REVERSAL" ? "Reverse sale" : "Record return"}
      destructive
      busy={saving}
      onCancel={() => setPendingCorrection(null)}
      onConfirm={() => { void submitCorrection(); }}
    />
  </div>
  <PaymentProcessingOverlay message={generatingReceipt ? "Generating receipt…" : null} />
  </>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[#7d8792]">{label}</span><span className="text-right font-medium text-[#344151]">{value}</span></div>;
}
