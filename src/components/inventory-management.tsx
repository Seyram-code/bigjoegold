"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { calculatePurchaseMeasurements } from "@/lib/gold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { StockAutocomplete, type StockOption } from "@/components/ui/stock-autocomplete";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { formatCurrency, formatCurrencyExact, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { useToast } from "@/components/ui/toast-provider";
import { stocktakeVariance } from "@/lib/stocktake";
import type { PurchaseFormulaRules } from "@/lib/purchase-formula";

type ReceivingPrice = {
  id: string;
  priceAmount: string | number;
  currency: string;
  priceUnit: string;
  effectiveAt: string;
  source: string;
};

type Lot = {
  id: string;
  batchNumber: string;
  source: string;
  receivedAt: string;
  originalGrams: string | number;
  remainingGrams: string | number;
  ledgerBalanceGrams: string | number;
  cachedRemainingGrams: string | number;
  cacheMismatch: boolean;
  costPerGram: string | number;
  purityBps: number;
  density: string | number | null;
  pounds: string | number | null;
  status: "ACTIVE" | "DEPLETED" | "QUARANTINED";
  storageLocation: { id: string; name: string } | null;
  trade: {
    reference: string;
    type: string;
    status: string;
    priceUnit: string;
    boardPriceId: string | null;
    purchaseMeasurement: {
      topKg: string | number;
      downKg: string | number;
      pounds: string | number;
      density: string | number;
      karat: string | number;
      calculationSource: string;
    } | null;
    boardPrice: ReceivingPrice | null;
    buyerFinanceSettlement: { id: string } | null;
  } | null;
  measurementEditable: boolean;
};

type Movement = {
  id: string;
  reference: string;
  type: string;
  quantityGrams: string | number;
  movementDate: string;
  reason: string | null;
  transferReference: string | null;
  trade: { reference: string } | null;
  inventoryLot: { batchNumber: string } | null;
  location: { name: string } | null;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  createdBy: { name: string };
};

type StocktakeLine = {
  id: string;
  inventoryLotId: string;
  batchNumber: string;
  locationName: string;
  expectedGrams: string | number;
  countedGrams: string | number | null;
  varianceGrams: string | number;
  costPerGram: string | number;
  reason: string | null;
  correctionRef: string | null;
};
type StocktakeSession = {
  id: string;
  reference: string;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  startedAt: string;
  closedAt: string | null;
  createdBy: { name: string };
  closedBy: { name: string } | null;
  lines: StocktakeLine[];
};
type StocktakeHistory = Omit<StocktakeSession, "lines"> & {
  lines: Pick<StocktakeLine, "id" | "expectedGrams" | "countedGrams" | "varianceGrams">[];
};

export type InventoryView = "opening" | "adjustment" | "transfers" | "current" | "batches" | "movements" | "alerts" | "reconciliation";
type FormValues = Record<string, string>;

const dateTimeLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
}

function movementLabel(type: string) {
  return ({
    OPENING_BALANCE: "Opening stock",
    PURCHASE_RECEIPT: "Purchase received",
    SALE_ISSUE: "Sale deduction",
    SALE_RETURN: "Return",
    ADJUSTMENT_IN: "Adjustment in",
    ADJUSTMENT_OUT: "Adjustment out",
    TRANSFER_IN: "Transfer in",
    TRANSFER_OUT: "Transfer out",
    STOCK_CORRECTION_IN: "Correction in",
    STOCK_CORRECTION_OUT: "Correction out",
    MEASUREMENT_CORRECTION_IN: "Measurement correction in",
    MEASUREMENT_CORRECTION_OUT: "Measurement correction out",
  } as Record<string, string>)[type] ?? type;
}

export function InventoryManagement({
  view,
  canOpen,
  canAdjust,
  canTransfer,
  canReconcile,
  canEditMeasurements,
}: {
  view: InventoryView;
  canOpen: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
  canReconcile: boolean;
  canEditMeasurements: boolean;
}) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [receivingPrices, setReceivingPrices] = useState<ReceivingPrice[]>([]);
  const [purchaseFormula, setPurchaseFormula] = useState<PurchaseFormulaRules | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [summary, setSummary] = useState<Record<string, number | null>>({});
  const [movements, setMovements] = useState<Movement[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();
  const [pendingMovement, setPendingMovement] = useState<{ action: string; values: Record<string, unknown> } | null>(null);
  const [stocktake, setStocktake] = useState<StocktakeSession | null>(null);
  const [stocktakeHistory, setStocktakeHistory] = useState<StocktakeHistory[]>([]);
  const [confirmStocktake, setConfirmStocktake] = useState(false);
  const [confirmCancelStocktake, setConfirmCancelStocktake] = useState(false);
  const [editingLot, setEditingLot] = useState<Lot | null>(null);
  const [measurementForm, setMeasurementForm] = useState({ topGrams: "", downGrams: "", boardPriceId: "", reason: "" });
  const stocktakeDirty = useRef(false);
  const [form, setForm] = useState<FormValues>({
    batchNumber: "",
    source: "",
    receivedAt: dateTimeLocal(),
    quantityKg: "",
    pounds: "",
    density: "",
    purityBps: "9999",
    costPerGram: "0",
    storageLocation: "Main storage",
    lotId: "",
    direction: "IN",
    quantityGrams: "",
    destinationLocation: "",
    countedGrams: "",
    reason: "",
  });

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const [inventoryResponse, movementResponse] = await Promise.all([
        fetch("/api/inventory", { cache: "no-store" }),
        view === "movements"
          ? fetch(`/api/inventory/movements?page=${page}&pageSize=100`, { cache: "no-store" })
          : Promise.resolve(null),
      ]);
      const stocktakeResponse = view === "reconciliation" && !background
        ? await fetch("/api/inventory/reconciliations", { cache: "no-store" })
        : null;
      const [inventoryBody, movementBody, stocktakeBody]: [unknown, unknown, unknown] = await Promise.all([
        inventoryResponse.json(),
        movementResponse ? movementResponse.json() : Promise.resolve(null),
        stocktakeResponse ? stocktakeResponse.json() : Promise.resolve(null),
      ]);
      if (!inventoryResponse.ok) throw new Error(messageFrom(inventoryBody, "Unable to load inventory"));
      if (inventoryBody && typeof inventoryBody === "object") {
        const data = inventoryBody as {
          lots?: Lot[];
          locations?: { id: string; name: string }[];
          summary?: Record<string, number | null>;
          receivingPrices?: ReceivingPrice[];
          purchaseFormula?: PurchaseFormulaRules;
        };
        setLots(Array.isArray(data.lots) ? data.lots : []);
        setReceivingPrices(Array.isArray(data.receivingPrices) ? data.receivingPrices : []);
        setPurchaseFormula(data.purchaseFormula ?? null);
        setLocations(Array.isArray(data.locations) ? data.locations : []);
        setSummary(data.summary ?? {});
        setForm((current) => ({
          ...current,
          lotId: current.lotId || data.lots?.find((lot) => Number(lot.ledgerBalanceGrams) > 0)?.id || data.lots?.[0]?.id || "",
          storageLocation: current.storageLocation || data.locations?.[0]?.name || "Main storage",
          destinationLocation: current.destinationLocation || data.locations?.find((location) => location.name !== current.storageLocation)?.name || "",
        }));
      }
      if (movementResponse) {
        if (!movementResponse.ok) throw new Error(messageFrom(movementBody, "Unable to load the stock ledger"));
        if (movementBody && typeof movementBody === "object") {
          const data = movementBody as { movements?: Movement[]; pageCount?: number };
          setMovements(Array.isArray(data.movements) ? data.movements : []);
          setPageCount(data.pageCount ?? 1);
        }
      }
      if (stocktakeResponse) {
        if (!stocktakeResponse.ok) throw new Error(messageFrom(stocktakeBody, "Unable to load physical stocktakes"));
        if (!stocktakeBody || typeof stocktakeBody !== "object" || !("active" in stocktakeBody) || !("history" in stocktakeBody)) {
          throw new Error("The stocktake service returned an invalid response");
        }
        const data = stocktakeBody as { active: StocktakeSession | null; history: StocktakeHistory[] };
        stocktakeDirty.current = false;
        setStocktake(data.active);
        setStocktakeHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load inventory");
    } finally {
      setLoading(false);
    }
  }, [page, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(() => load(true));

  function update(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submit(action: string, values: Record<string, unknown>) {
    setPendingMovement({ action, values });
  }

  async function commitMovement() {
    if (!pendingMovement) return;
    const { action, values } = pendingMovement;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...values }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to post the stock movement"));
      showToast(action === "TRANSFER" ? "The batch transfer was recorded as paired stock movements." : action === "RECONCILE" ? "The physical count was reconciled through an audited correction movement." : action === "OPENING" ? "Opening stock and its ledger entry were recorded." : "Stock adjustment and its ledger entry were recorded.");
      setPendingMovement(null);
      setForm((current) => ({ ...current, quantityKg: "", quantityGrams: "", countedGrams: "", reason: "", batchNumber: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to post the stock movement");
    } finally {
      setBusy(false);
    }
  }

  function startMeasurementEdit(lot: Lot) {
    const measurement = lot.trade?.purchaseMeasurement;
    if (!measurement) return;
    setEditingLot(lot);
    setMeasurementForm({
      topGrams: String(Number(measurement.topKg) * 1000),
      downGrams: String(Number(measurement.downKg) * 1000),
      boardPriceId: lot.trade?.boardPriceId ?? lot.trade?.boardPrice?.id ?? "",
      reason: "",
    });
  }

  async function saveMeasurementEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingLot) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/lots/${encodeURIComponent(editingLot.id)}/measurement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(measurementForm),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to correct the purchase measurements"));
      showToast("Purchase measurements, purchase value, and stock balance were corrected.");
      setEditingLot(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to correct the purchase measurements");
    } finally {
      setBusy(false);
    }
  }

  async function startStocktake() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "START" }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to start a physical stocktake"));
      await load();
      showToast("Stocktake started. Count each listed batch before reviewing variances.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start a physical stocktake");
    } finally {
      setBusy(false);
    }
  }

  function updateStocktakeLine(lineId: string, field: "countedGrams" | "reason", value: string) {
    stocktakeDirty.current = true;
    setStocktake((current) => current ? ({
      ...current,
      lines: current.lines.map((line) => line.id === lineId
        ? { ...line, [field]: value }
        : line),
    }) : current);
  }

  async function saveStocktakeCounts() {
    if (!stocktake) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SAVE_COUNTS",
          reconciliationId: stocktake.id,
          counts: stocktake.lines.map((line) => ({
            lineId: line.id,
            countedGrams: line.countedGrams === null ? "" : String(line.countedGrams),
            reason: line.reason ?? "",
          })),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to save stocktake counts"));
      stocktakeDirty.current = false;
      await load();
      showToast("Physical counts saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save stocktake counts");
    } finally {
      setBusy(false);
    }
  }

  async function completeStocktake() {
    if (!stocktake) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "COMPLETE", reconciliationId: stocktake.id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to complete stocktake"));
      setConfirmStocktake(false);
      setStocktake(null);
      stocktakeDirty.current = false;
      await load();
      showToast("Stocktake completed and variance corrections posted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete stocktake");
    } finally {
      setBusy(false);
    }
  }

  async function cancelStocktake() {
    if (!stocktake) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", reconciliationId: stocktake.id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(body, "Unable to cancel stocktake"));
      setConfirmCancelStocktake(false);
      setStocktake(null);
      stocktakeDirty.current = false;
      await load();
      showToast("Stocktake cancelled. No stock corrections were posted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel stocktake");
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<InventoryView, string> = {
    opening: "Record opening stock",
    adjustment: "Manual stock adjustment",
    transfers: "Stock transfers",
    current: "Current stock",
    batches: "Gold batches",
    movements: "Stock movements",
    alerts: "Stock alerts",
    reconciliation: "Stock reconciliation",
  };
  const issueLots = lots.filter((lot) => Number(lot.ledgerBalanceGrams) > 0);
  const alertLots = lots.filter((lot) => lot.cacheMismatch || Number(lot.ledgerBalanceGrams) < 0 || lot.status === "QUARANTINED");
  const activeWeightKg = Number(summary.kilograms ?? 0);
  const isForm = ["opening", "adjustment", "transfers", "reconciliation"].includes(view);
  const countedStocktakeLines = stocktake?.lines.filter((line) => line.countedGrams !== null && String(line.countedGrams).trim() !== "") ?? [];
  const stocktakeVarianceLines = countedStocktakeLines.filter((line) =>
    !stocktakeVariance(line.expectedGrams, String(line.countedGrams), line.costPerGram).varianceGrams.isZero());
  const stocktakeCostImpact = stocktakeVarianceLines.reduce((sum, line) =>
    sum + Number(stocktakeVariance(line.expectedGrams, String(line.countedGrams), line.costPerGram).costImpact), 0);
  const allStocktakeCountsEntered = Boolean(stocktake && countedStocktakeLines.length === stocktake.lines.length);
  const allStocktakeVariancesExplained = stocktakeVarianceLines.every((line) => Boolean(line.reason?.trim()));

  const measurementPrices = editingLot?.trade?.boardPrice
    && !receivingPrices.some((price) => price.id === editingLot.trade?.boardPrice?.id)
    ? [...receivingPrices, editingLot.trade.boardPrice]
    : receivingPrices;
  const selectedMeasurementPrice = measurementPrices.find((price) => price.id === measurementForm.boardPriceId);
  let measurementPreview: ReturnType<typeof calculatePurchaseMeasurements> | null = null;
  let measurementPreviewError = "";
  if (editingLot && purchaseFormula && selectedMeasurementPrice) {
    try {
      measurementPreview = calculatePurchaseMeasurements(
        measurementForm.topGrams,
        measurementForm.downGrams,
        String(selectedMeasurementPrice.priceAmount),
        purchaseFormula,
      );
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      measurementPreviewError = cause.message;
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-medium text-[#8b949e]">Workspace / Inventory</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{titles[view]}</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-[#76808c]">Available stock is calculated from the immutable movement ledger. Batch balance fields are checked against that ledger before stock is changed.</p>
      </div>
      <RefreshButton loading={loading} onClick={() => { void load(); }} />
    </div>
    <AlertDialog open={Boolean(error)} title={view === "reconciliation" ? "Stocktake error" : "Inventory error"} description={error} onConfirm={() => setError("")} />
    {summary.ledgerMismatchCount ? <AlertDialog open title="Inventory reconciliation warning" variant="warning" description={`${summary.ledgerMismatchCount} batch balance(s) differ from the stock ledger. Selling or adjusting affected batches is blocked until they are reconciled.`} onConfirm={() => {}} /> : null}

    {["current", "batches", "alerts"].includes(view) && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Ledger stock" value={formatWeight(activeWeightKg, "kg", 2)} />
      {view === "current" && <Metric label="Available stock" value={formatWeight(activeWeightKg * 1000, "g", 2)} />}
      <Metric label="Available top" value={formatWeight(Number(summary.topGrams ?? 0), "g", 2)} />
      <Metric label="Available down" value={formatWeight(Number(summary.downGrams ?? 0), "g", 2)} />
      <Metric label="Available pounds" value={summary.pounds === null ? "—" : `${formatDecimalTruncated(summary.pounds ?? 0, 2)} lb`} />
      <Metric label="Available density" value={summary.density === null ? "—" : formatDecimalTruncated(summary.density ?? 0, 2)} />
      <Metric label="Available karat" value={summary.karat === null ? "—" : formatDecimalTruncated(summary.karat ?? 0, 2)} />
      <Metric label="Stock cost value" value={formatCurrency(Number(summary.costValue ?? 0))} />
      <Metric label="Active batches" value={String(summary.batchCount ?? 0)} />
    </div>}

    {isForm && <Card className="border-[#e3d4b8]">
      <CardHeader><CardTitle>{titles[view]}</CardTitle><p className="mt-1 text-xs text-[#75808d]">{view === "reconciliation" ? "Count each listed batch, review all differences and their estimated cost impact, then post the corrections to the stock ledger." : "All changes are recorded as stock movements with a reason and the signed-in user."}</p></CardHeader>
      <CardContent>
        {view === "opening" && <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => {
          event.preventDefault();
          void submit("OPENING", {
            batchNumber: form.batchNumber,
            source: form.source,
            receivedAt: new Date(form.receivedAt).toISOString(),
            quantityKg: form.quantityKg,
            pounds: form.pounds,
            density: form.density,
            purityBps: form.purityBps,
            costPerGram: form.costPerGram,
            storageLocation: form.storageLocation,
            reason: form.reason,
          });
        }}>
          <FormField label="Batch number" htmlFor="inventory-batch" hint="Leave blank to generate an 8-character code."><input id="inventory-batch" value={form.batchNumber} onChange={(event) => update("batchNumber", event.target.value)} className={fieldControlClass} placeholder="Generated if blank" /></FormField>
          <FormField label="Source or supplier" htmlFor="inventory-source"><input id="inventory-source" required value={form.source} onChange={(event) => update("source", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Received date" htmlFor="inventory-date"><CalendarPicker id="inventory-date" includeTime max={dateTimeLocal()} required value={form.receivedAt} onChange={(value) => update("receivedAt", value)} /></FormField>
          <FormField label="Weight (KG)" htmlFor="inventory-kg"><input id="inventory-kg" type="number" required min="0.00000001" step="0.00000001" value={form.quantityKg} onChange={(event) => update("quantityKg", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Weight (pounds, optional)" htmlFor="inventory-pounds"><input id="inventory-pounds" type="number" min="0.00000001" step="0.00000001" value={form.pounds} onChange={(event) => update("pounds", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Karat purity (basis points)" htmlFor="inventory-purity"><input id="inventory-purity" type="number" required min="1" max="10000" step="1" value={form.purityBps} onChange={(event) => update("purityBps", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Density (optional)" htmlFor="inventory-density"><input id="inventory-density" type="number" min="0.00000001" step="0.00000001" value={form.density} onChange={(event) => update("density", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Purchase cost per gram (GHS)" htmlFor="inventory-cost"><GhanaAmountInput id="inventory-cost" required min="0" step="0.000001" decimalScale={6} value={form.costPerGram} onChange={(value) => update("costPerGram", value)} className={fieldControlClass} /></FormField>
          <FormField label="Storage location" htmlFor="inventory-location"><input id="inventory-location" required list="inventory-location-options" value={form.storageLocation} onChange={(event) => update("storageLocation", event.target.value)} className={fieldControlClass} /><LocationOptions locations={locations} /></FormField>
          <FormField label="Reason / opening stock reference" htmlFor="inventory-reason"><input id="inventory-reason" required minLength={5} maxLength={500} value={form.reason} onChange={(event) => update("reason", event.target.value)} className={fieldControlClass} placeholder="Opening balance as of stocktake date" /></FormField>
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy || !canOpen}>{busy ? "Saving…" : "Record opening stock"}</Button></div>
        </form>}

        {view === "adjustment" && <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void submit("ADJUST", { lotId: form.lotId, direction: form.direction, quantityGrams: form.quantityGrams, reason: form.reason }); }}>
          <FormField label="Stock batch" htmlFor="adjust-lot"><LotOptions id="adjust-lot" lots={lots} value={form.lotId} onChange={(value) => update("lotId", value)} includeZero /></FormField>
          <FormField label="Adjustment direction" htmlFor="adjust-direction"><select id="adjust-direction" value={form.direction} onChange={(event) => update("direction", event.target.value)} className={fieldControlClass}><option value="IN">Increase stock</option><option value="OUT">Decrease stock</option></select></FormField>
          <FormField label="Adjustment weight (grams)" htmlFor="adjust-grams"><input id="adjust-grams" type="number" required min="0.00001" step="0.00001" value={form.quantityGrams} onChange={(event) => update("quantityGrams", event.target.value)} className={fieldControlClass} /></FormField>
          <ReasonField value={form.reason} onChange={(value) => update("reason", value)} id="adjust-reason" />
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy || !canAdjust}>{busy ? "Saving…" : "Post adjustment"}</Button></div>
        </form>}

        {view === "transfers" && <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void submit("TRANSFER", { lotId: form.lotId, quantityGrams: form.quantityGrams, destinationLocation: form.destinationLocation, reason: form.reason }); }}>
          <FormField label="Stock batch" htmlFor="transfer-lot"><LotOptions id="transfer-lot" lots={issueLots} value={form.lotId} onChange={(value) => update("lotId", value)} /></FormField>
          <FormField label="Transfer weight (grams)" htmlFor="transfer-grams"><input id="transfer-grams" type="number" required min="0.00001" step="0.00001" value={form.quantityGrams} onChange={(event) => update("quantityGrams", event.target.value)} className={fieldControlClass} /></FormField>
          <FormField label="Destination location" htmlFor="transfer-destination"><input id="transfer-destination" required list="inventory-location-options" value={form.destinationLocation} onChange={(event) => update("destinationLocation", event.target.value)} className={fieldControlClass} /><LocationOptions locations={locations} /></FormField>
          <ReasonField value={form.reason} onChange={(value) => update("reason", value)} id="transfer-reason" />
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy || !canTransfer}>{busy ? "Saving…" : "Transfer stock"}</Button></div>
          <p className="text-xs text-[#76808c] sm:col-span-2 xl:col-span-3">Transfers produce paired ledger entries. Partial transfers preserve the same batch number, source, assay, and unit cost at the destination.</p>
        </form>}

        {view === "reconciliation" && <div className="space-y-5">
          {!stocktake && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e8ebef] p-4">
            <div><p className="text-sm font-semibold text-[#344151]">No stocktake in progress</p><p className="mt-1 text-xs text-[#76808c]">Start a snapshot of all active, quarantined, or mismatched batches. You can save the counts and return later.</p></div>
            <Button type="button" variant="gold" disabled={busy || loading || !canReconcile} onClick={() => { void startStocktake(); }}>{busy ? "Starting…" : "Start stocktake"}</Button>
          </div>}
          {stocktake && <>
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#e8ebef] p-4">
              <div><p className="text-sm font-semibold text-[#344151]">{stocktake.reference} · In progress</p><p className="mt-1 text-xs text-[#76808c]">Started {new Date(stocktake.startedAt).toLocaleString("en-GH")} by {stocktake.createdBy.name}. Expected quantities are snapshotted from the stock ledger.</p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy || !canReconcile || !stocktakeDirty.current} onClick={() => { void saveStocktakeCounts(); }}>Save counts</Button>
                <Button type="button" variant="outline" disabled={busy || !canReconcile} onClick={() => setConfirmCancelStocktake(true)}>Cancel stocktake</Button>
                <Button type="button" variant="gold" disabled={busy || !canReconcile || !allStocktakeCountsEntered || !allStocktakeVariancesExplained || stocktakeDirty.current} onClick={() => setConfirmStocktake(true)}>Review and post corrections</Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Batches counted" value={`${countedStocktakeLines.length} / ${stocktake.lines.length}`} />
              <Metric label="Batches with variance" value={String(stocktakeVarianceLines.length)} />
              <Metric label="Estimated stock-value variance" value={formatCurrency(stocktakeCostImpact)} />
            </div>
            {!allStocktakeCountsEntered && <p className="text-xs text-amber-700">Enter a physical weight for every batch. Enter 0 when a batch is not physically present.</p>}
            <div className="overflow-x-auto rounded-lg border border-[#e8ebef]">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-[#f7f8fa] text-[10px] uppercase tracking-wide text-[#7c8793]">
                  <tr>{["Batch", "Location", "Expected (g)", "Physical count (g)", "Variance (g)", "Estimated value impact", "Reason for variance"].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-3 font-semibold">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f2]">
                  {stocktake.lines.map((line) => {
                    const hasCount = line.countedGrams !== null && String(line.countedGrams).trim() !== "";
                    const variance = hasCount
                      ? stocktakeVariance(line.expectedGrams, String(line.countedGrams), line.costPerGram)
                      : null;
                    return <tr key={line.id}>
                      <td className="px-3 py-3 font-medium text-[#344151]">{line.batchNumber}</td>
                      <td className="px-3 py-3 text-[#63707e]">{line.locationName}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatWeight(line.expectedGrams, "g", 5)}</td>
                      <td className="px-3 py-2"><input
                        aria-label={`Physical count for ${line.batchNumber}`}
                        type="number"
                        min="0"
                        step="0.00001"
                        value={line.countedGrams ?? ""}
                        disabled={!canReconcile || busy}
                        onChange={(event) => updateStocktakeLine(line.id, "countedGrams", event.target.value)}
                        className={`${fieldControlClass} min-w-36`}
                      /></td>
                      <td className={`whitespace-nowrap px-3 py-3 tabular-nums ${variance && !variance.varianceGrams.isZero() ? variance.varianceGrams.isNegative() ? "text-red-700" : "text-emerald-700" : "text-[#63707e]"}`}>
                        {variance ? `${variance.varianceGrams.isPositive() ? "+" : ""}${formatWeight(variance.varianceGrams.abs().toString(), "g", 5)}${variance.varianceGrams.isNegative() ? " less" : variance.varianceGrams.isPositive() ? " more" : ""}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{variance ? formatCurrency(variance.costImpact.toString()) : "—"}</td>
                      <td className="px-3 py-2"><input
                        aria-label={`Reason for variance in ${line.batchNumber}`}
                        value={line.reason ?? ""}
                        disabled={!canReconcile || busy}
                        onChange={(event) => updateStocktakeLine(line.id, "reason", event.target.value)}
                        maxLength={500}
                        placeholder={variance && !variance.varianceGrams.isZero() ? "Required for variance" : "Optional"}
                        className={`${fieldControlClass} min-w-56`}
                      /></td>
                    </tr>;
                  })}
                  {!stocktake.lines.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#89929d]">No batches were included in this stocktake.</td></tr>}
                </tbody>
              </table>
            </div>
            {stocktakeDirty.current && <p className="text-xs text-amber-700">You have unsaved count changes. Save counts before reviewing and posting corrections.</p>}
          </>}
          {!canReconcile && <p className="text-xs text-red-700">You need inventory reconciliation permission to start or post a stocktake.</p>}
          {stocktakeHistory.length > 0 && <div className="space-y-2 border-t border-[#edf0f3] pt-4">
            <h3 className="text-sm font-semibold text-[#344151]">Recent stocktake history</h3>
            {stocktakeHistory.map((item) => {
              const varianceCount = item.lines.filter((line) => line.countedGrams !== null
                && !stocktakeVariance(line.expectedGrams, String(line.countedGrams), 1).varianceGrams.isZero()).length;
              return <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[#f7f8fa] px-3 py-2 text-xs">
                <span className="font-medium text-[#344151]">{item.reference} · {item.status === "COMPLETED" ? "Completed" : "Cancelled"} · {item.lines.length} batches · {varianceCount} variances</span>
                <span className="text-[#76808c]">{item.closedAt ? new Date(item.closedAt).toLocaleString("en-GH") : "—"} · {item.closedBy?.name ?? "—"}</span>
              </div>;
            })}
          </div>}
        </div>}
        {!canOpen && view === "opening" && <AlertDialog open title="Permission required" description="You do not have permission to record opening stock." onConfirm={() => {}} />}
        {!canAdjust && view === "adjustment" && <AlertDialog open title="Permission required" description="You do not have permission to adjust stock." onConfirm={() => {}} />}
        {!canTransfer && view === "transfers" && <AlertDialog open title="Permission required" description="You do not have permission to transfer stock." onConfirm={() => {}} />}
        {!canReconcile && view === "reconciliation" && <AlertDialog open title="Permission required" description="You do not have permission to reconcile stock." onConfirm={() => {}} />}
      </CardContent>
    </Card>}

    {["current", "batches", "alerts"].includes(view) && <LotsTable
      lots={view === "alerts" ? alertLots : lots}
      showAlerts={view === "alerts"}
      canEditMeasurements={canEditMeasurements && view !== "alerts"}
      onEditMeasurement={startMeasurementEdit}
    />}
    {view === "movements" && <Card><CardHeader><CardTitle>Immutable stock ledger</CardTitle><p className="mt-1 text-xs text-[#75808d]">{loading ? "Loading ledger…" : `Page ${page} of ${pageCount}`}</p></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[1100px] border-collapse text-left text-xs"><thead><tr className="border-y border-[#edf0f3] bg-[#fafbfc] text-[10px] uppercase tracking-wide text-[#89929d]"><th className="px-4 py-3">Movement</th><th className="px-4 py-3">Reference / batch</th><th className="px-4 py-3">Trade</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Location / transfer</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Recorded by</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id} className="border-b border-[#f0f2f4] text-[#63707e]"><td className="px-4 py-3"><Badge tone={movement.type.includes("OUT") || movement.type === "SALE_ISSUE" ? "red" : "green"}>{movementLabel(movement.type)}</Badge></td><td className="px-4 py-3 font-medium text-[#344151]">{movement.reference}<span className="block text-[10px] text-[#87919d]">{movement.inventoryLot?.batchNumber || "—"}</span></td><td className="px-4 py-3">{movement.trade?.reference ?? "—"}</td><td className="px-4 py-3">{formatWeight(movement.quantityGrams, "g", 2)}</td><td className="px-4 py-3">{movement.transferReference ? `${movement.fromLocation?.name ?? "—"} → ${movement.toLocation?.name ?? "—"}` : movement.location?.name ?? "—"}</td><td className="max-w-[250px] px-4 py-3">{movement.reason ?? "—"}</td><td className="px-4 py-3">{new Date(movement.movementDate).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</td><td className="px-4 py-3">{movement.createdBy.name}</td></tr>)}</tbody></table>{!loading && movements.length === 0 && <p className="p-8 text-center text-xs text-[#89929d]">No stock movements have been recorded.</p>}<div className="flex items-center justify-between border-t border-[#edf0f3] px-4 py-3"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="text-xs text-[#75808d]">Page {page} / {pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div></CardContent></Card>}
    <ConfirmDialog
      open={Boolean(pendingMovement)}
      title={`Confirm ${pendingMovement?.action === "RECONCILE" ? "stock reconciliation" : pendingMovement?.action === "TRANSFER" ? "stock transfer" : pendingMovement?.action === "ADJUST" ? "stock adjustment" : "opening stock"}`}
      description="This action creates permanent stock ledger entries and cannot be erased. Verify the batch, quantity, location, and reason before continuing."
      confirmLabel="Record stock movement"
      destructive={pendingMovement?.action === "ADJUST" || pendingMovement?.action === "RECONCILE"}
      busy={busy}
      onCancel={() => setPendingMovement(null)}
      onConfirm={() => { void commitMovement(); }}
    />
    <ConfirmDialog
      open={confirmStocktake}
      title={`Complete stocktake ${stocktake?.reference ?? ""}?`}
      description={`This posts ${stocktakeVarianceLines.length} audited stock correction(s). Estimated stock-value variance: ${formatCurrency(stocktakeCostImpact)}. The count snapshot and all correction entries will be retained in the audit history.`}
      confirmLabel="Post corrections"
      destructive={stocktakeVarianceLines.some((line) => stocktakeVariance(line.expectedGrams, String(line.countedGrams), line.costPerGram).varianceGrams.isNegative())}
      busy={busy}
      onCancel={() => setConfirmStocktake(false)}
      onConfirm={() => { void completeStocktake(); }}
    />
    <ConfirmDialog
      open={confirmCancelStocktake}
      title={`Cancel stocktake ${stocktake?.reference ?? ""}?`}
      description="Saved counts will remain in the history, but no stock corrections will be posted. You can start a new stocktake afterward."
      confirmLabel="Cancel stocktake"
      destructive
      busy={busy}
      onCancel={() => setConfirmCancelStocktake(false)}
      onConfirm={() => { void cancelStocktake(); }}
    />
    {editingLot && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingLot(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="inventory-measurement-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="inventory-measurement-title" className="text-base font-semibold text-[#17212f]">Correct received gold measurements</h2>
            <p className="mt-1 text-xs text-[#75808d]">{editingLot.batchNumber || editingLot.trade?.reference} · {editingLot.source}</p>
          </div>
          <button type="button" aria-label="Close measurement editor" onClick={() => setEditingLot(null)} disabled={busy} className="rounded-lg p-2 text-[#75808d] hover:bg-[#f3f5f7] disabled:opacity-50"><X size={17} /></button>
        </div>
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Change the top/down weights or select a different published receiving price. The preview recalculates pounds, density, karat, purity, and the purchase amount. Saving also updates cost per gram and stock balance. Existing cash payments remain unchanged; batches with sales or other stock activity must be reconciled separately.</p>
        <form onSubmit={(event) => { void saveMeasurementEdit(event); }} className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Top weight (grams)" htmlFor="inventory-edit-top-weight">
            <input id="inventory-edit-top-weight" type="number" required min="0.00001" step="0.00001" value={measurementForm.topGrams} onChange={(event) => setMeasurementForm((current) => ({ ...current, topGrams: event.target.value }))} className={fieldControlClass} />
          </FormField>
          <FormField label="Down weight (grams)" htmlFor="inventory-edit-down-weight">
            <input id="inventory-edit-down-weight" type="number" required min="0.00001" step="0.00001" value={measurementForm.downGrams} onChange={(event) => setMeasurementForm((current) => ({ ...current, downGrams: event.target.value }))} className={fieldControlClass} />
          </FormField>
          <FormField label="Receiving price (GHS per pure gram)" htmlFor="inventory-edit-price" className="sm:col-span-2">
            <select id="inventory-edit-price" required value={measurementForm.boardPriceId} onChange={(event) => setMeasurementForm((current) => ({ ...current, boardPriceId: event.target.value }))} className={fieldControlClass}>
              <option value="">Select a published receiving price</option>
              {measurementPrices.map((price) => <option key={price.id} value={price.id}>
                {formatCurrencyExact(String(price.priceAmount))} / g · {price.source} · {new Date(price.effectiveAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}
              </option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f7f8fa] p-3 sm:col-span-2 sm:grid-cols-3">
            <MeasurementValue label="Pounds" value={measurementPreview ? `${formatDecimalTruncated(measurementPreview.pounds.toString(), 2)} lb` : "—"} />
            <MeasurementValue label="Density" value={measurementPreview ? formatDecimalTruncated(measurementPreview.density.toString(), 2) : "—"} />
            <MeasurementValue label="Karat" value={measurementPreview ? formatDecimalTruncated(measurementPreview.karat.toString(), 2) : "—"} />
            <MeasurementValue label="Purity" value={measurementPreview ? `${formatDecimalTruncated(measurementPreview.purity.toString(), 2)}%` : "—"} />
            <MeasurementValue label="Price per gram" value={selectedMeasurementPrice ? `${formatCurrencyExact(String(selectedMeasurementPrice.priceAmount))} / g` : "—"} />
            <MeasurementValue label="New purchase amount" value={measurementPreview ? formatCurrencyExact(measurementPreview.amount.toString()) : "—"} emphasized />
          </div>
          {measurementPreviewError && <p role="status" className="text-xs text-red-700 sm:col-span-2">{measurementPreviewError}</p>}
          {!purchaseFormula && <p role="status" className="text-xs text-red-700 sm:col-span-2">Purchase formula details are unavailable. Reload the page before making a correction.</p>}
          <FormField label="Reason for correction (required)" htmlFor="inventory-edit-reason" className="sm:col-span-2">
            <input id="inventory-edit-reason" required minLength={5} maxLength={500} value={measurementForm.reason} onChange={(event) => setMeasurementForm((current) => ({ ...current, reason: event.target.value }))} className={fieldControlClass} />
          </FormField>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setEditingLot(null)} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="gold" disabled={busy || !measurementPreview}>{busy ? "Saving…" : "Save corrected measurements"}</Button>
          </div>
        </form>
      </section>
    </div>}
  </div>;
}

function MeasurementValue({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div>
    <p className="text-[10px] font-medium uppercase tracking-wide text-[#89929d]">{label}</p>
    <p className={`mt-1 text-sm tabular-nums ${emphasized ? "font-semibold text-[#795719]" : "font-medium text-[#344151]"}`}>{value}</p>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="py-4"><p className="text-[10px] font-medium uppercase tracking-wide text-[#89929d]">{label}</p><p className="mt-2 text-lg font-semibold text-[#263342]">{value}</p></CardContent></Card>;
}

function LocationOptions({ locations }: { locations: { id: string; name: string }[] }) {
  return <datalist id="inventory-location-options">{locations.map((location) => <option key={location.id} value={location.name} />)}</datalist>;
}

function LotOptions({ id, lots, value, onChange, includeZero = false }: { id: string; lots: Lot[]; value: string; onChange: (value: string) => void; includeZero?: boolean }) {
  const options: StockOption[] = lots
    .filter((lot) => includeZero || Number(lot.ledgerBalanceGrams) > 0)
    .map((lot) => ({
      id: lot.id,
      source: lot.source,
      batchNumber: lot.batchNumber || lot.trade?.reference || lot.id,
      receivedAt: lot.receivedAt,
      grams: lot.ledgerBalanceGrams,
    }));
  return <StockAutocomplete id={id} lots={options} value={value} onChange={onChange} required placeholder="Search stock batches" />;
}

function ReasonField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <FormField label="Reason (required for audit)" htmlFor={id}><input id={id} required minLength={5} maxLength={500} value={value} onChange={(event) => onChange(event.target.value)} className={fieldControlClass} /></FormField>;
}

function LotsTable({ lots, showAlerts, canEditMeasurements, onEditMeasurement }: { lots: Lot[]; showAlerts: boolean; canEditMeasurements: boolean; onEditMeasurement: (lot: Lot) => void }) {
  return <Card><CardHeader><CardTitle>{showAlerts ? "Batches needing attention" : "Stock by batch"}</CardTitle><p className="mt-1 text-xs text-[#75808d]">Remaining quantity is derived from the batch’s recorded stock movements.</p></CardHeader><CardContent className="overflow-x-auto p-0"><table className={`w-full ${canEditMeasurements ? "min-w-[1600px]" : "min-w-[1500px]"} border-collapse text-left text-xs`}><thead><tr className="border-y border-[#edf0f3] bg-[#fafbfc] text-[10px] uppercase tracking-wide text-[#89929d]"><th className="px-4 py-3">Batch / source</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Weight (g)</th><th className="px-4 py-3">Top (g)</th><th className="px-4 py-3">Down (g)</th><th className="px-4 py-3">Pounds</th><th className="px-4 py-3">Density</th><th className="px-4 py-3">Karat</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Cost / g</th><th className="px-4 py-3">Remaining (g)</th><th className="px-4 py-3">Status</th>{canEditMeasurements && <th className="px-4 py-3">Actions</th>}</tr></thead><tbody>{lots.map((lot) => {
    const measurement = lot.trade?.purchaseMeasurement;
    const topGrams = measurement ? Number(measurement.topKg) * 1000 : null;
    const downGrams = measurement ? Number(measurement.downKg) * 1000 : null;
    const pounds = measurement?.pounds ?? lot.pounds;
    const density = measurement?.density ?? lot.density;
    const karat = measurement?.karat ?? lot.purityBps / 10000 * 24;
    return <tr key={lot.id} className="border-b border-[#f0f2f4] text-[#63707e]"><td className="px-4 py-3 font-medium text-[#344151]">{lot.batchNumber || lot.trade?.reference || "—"}<span className="block text-[10px] text-[#87919d]">{lot.source || lot.trade?.reference || "Unknown source"}</span></td><td className="px-4 py-3">{new Date(lot.receivedAt).toLocaleDateString("en-GH")}</td><td className="px-4 py-3">{formatWeight(lot.originalGrams, "g", 2)}</td><td className="px-4 py-3">{topGrams === null ? "—" : formatDecimalTruncated(topGrams, 2)}</td><td className="px-4 py-3">{downGrams === null ? "—" : formatDecimalTruncated(downGrams, 2)}</td><td className="px-4 py-3">{pounds === null ? "—" : formatDecimalTruncated(pounds, 2)}</td><td className="px-4 py-3">{density === null ? "—" : formatDecimalTruncated(density, 2)}</td><td className="px-4 py-3">{formatDecimalTruncated(karat, 2)}</td><td className="px-4 py-3">{lot.storageLocation?.name ?? "—"}</td><td className="px-4 py-3">{formatCurrency(Number(lot.costPerGram))}</td><td className="px-4 py-3 font-semibold text-[#344151]">{formatWeight(lot.ledgerBalanceGrams, "g", 2)}</td><td className="px-4 py-3"><Badge tone={lot.cacheMismatch || Number(lot.ledgerBalanceGrams) < 0 ? "red" : lot.status === "DEPLETED" ? "gold" : "green"}>{lot.cacheMismatch ? "Ledger mismatch" : Number(lot.ledgerBalanceGrams) < 0 ? "Negative ledger" : lot.status}</Badge></td>{canEditMeasurements && <td className="px-4 py-3"><Button size="sm" variant="outline" disabled={!lot.measurementEditable} title={lot.measurementEditable ? "Edit the purchase measurements" : "Only untouched, eligible purchase batches can be edited."} onClick={() => onEditMeasurement(lot)}><Pencil size={13} /> Edit</Button>{!lot.measurementEditable && <span className="mt-1 block text-[10px] text-[#89929d]">Unavailable</span>}</td>}</tr>;
  })}</tbody></table>{lots.length === 0 && <p className="p-8 text-center text-xs text-[#89929d]">{showAlerts ? "No stock reconciliation alerts." : "No stock batches have been recorded."}</p>}</CardContent></Card>;
}
