"use client";

import { useCallback, useEffect, useState } from "react";
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
import { formatCurrency, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { useToast } from "@/components/ui/toast-provider";

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
  trade: { reference: string } | null;
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
  } as Record<string, string>)[type] ?? type;
}

export function InventoryManagement({
  view,
  canOpen,
  canAdjust,
  canTransfer,
  canReconcile,
}: {
  view: InventoryView;
  canOpen: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
  canReconcile: boolean;
}) {
  const [lots, setLots] = useState<Lot[]>([]);
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
      const [inventoryBody, movementBody]: [unknown, unknown] = await Promise.all([
        inventoryResponse.json(),
        movementResponse ? movementResponse.json() : Promise.resolve(null),
      ]);
      if (!inventoryResponse.ok) throw new Error(messageFrom(inventoryBody, "Unable to load inventory"));
      if (inventoryBody && typeof inventoryBody === "object") {
        const data = inventoryBody as { lots?: Lot[]; locations?: { id: string; name: string }[]; summary?: Record<string, number | null> };
        setLots(Array.isArray(data.lots) ? data.lots : []);
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

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-medium text-[#8b949e]">Workspace / Inventory</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{titles[view]}</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-[#76808c]">Available stock is calculated from the immutable movement ledger. Batch balance fields are checked against that ledger before stock is changed.</p>
      </div>
      <RefreshButton loading={loading} onClick={() => { void load(); }} />
    </div>
    <AlertDialog open={Boolean(error)} title="Inventory error" description={error} onConfirm={() => setError("")} />
    {summary.ledgerMismatchCount ? <AlertDialog open title="Inventory reconciliation warning" variant="warning" description={`${summary.ledgerMismatchCount} batch balance(s) differ from the stock ledger. Selling or adjusting affected batches is blocked until they are reconciled.`} onConfirm={() => {}} /> : null}

    {["current", "batches", "alerts"].includes(view) && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Ledger stock" value={formatWeight(activeWeightKg, "kg", 2)} />
      {view === "current" && <Metric label="Available stock" value={formatWeight(activeWeightKg * 1000, "g", 2)} />}
      <Metric label="Stock cost value" value={formatCurrency(Number(summary.costValue ?? 0))} />
      <Metric label="Active batches" value={String(summary.batchCount ?? 0)} />
    </div>}

    {isForm && <Card className="border-[#e3d4b8]">
      <CardHeader><CardTitle>{titles[view]}</CardTitle><p className="mt-1 text-xs text-[#75808d]">All changes are recorded as stock movements with a reason and the signed-in user.</p></CardHeader>
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
          <FormField label="Received date" htmlFor="inventory-date"><CalendarPicker id="inventory-date" includeTime required value={form.receivedAt} onChange={(value) => update("receivedAt", value)} /></FormField>
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

        {view === "reconciliation" && <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void submit("RECONCILE", { lotId: form.lotId, countedGrams: form.countedGrams, reason: form.reason }); }}>
          <FormField label="Stock batch" htmlFor="reconcile-lot"><LotOptions id="reconcile-lot" lots={lots} value={form.lotId} onChange={(value) => update("lotId", value)} includeZero /></FormField>
          <FormField label="Physical count (grams)" htmlFor="reconcile-count"><input id="reconcile-count" type="number" required min="0" step="0.00001" value={form.countedGrams} onChange={(event) => update("countedGrams", event.target.value)} className={fieldControlClass} /></FormField>
          <ReasonField value={form.reason} onChange={(value) => update("reason", value)} id="reconcile-reason" />
          <div className="flex items-end"><Button type="submit" variant="gold" disabled={busy || !canReconcile}>{busy ? "Saving…" : "Reconcile physical count"}</Button></div>
          <p className="text-xs text-[#76808c] sm:col-span-2 xl:col-span-3">The ledger balance is authoritative. A count difference creates a signed correction movement; it never edits or removes prior movements.</p>
        </form>}
        {!canOpen && view === "opening" && <AlertDialog open title="Permission required" description="You do not have permission to record opening stock." onConfirm={() => {}} />}
        {!canAdjust && view === "adjustment" && <AlertDialog open title="Permission required" description="You do not have permission to adjust stock." onConfirm={() => {}} />}
        {!canTransfer && view === "transfers" && <AlertDialog open title="Permission required" description="You do not have permission to transfer stock." onConfirm={() => {}} />}
        {!canReconcile && view === "reconciliation" && <AlertDialog open title="Permission required" description="You do not have permission to reconcile stock." onConfirm={() => {}} />}
      </CardContent>
    </Card>}

    {["current", "batches", "alerts"].includes(view) && <LotsTable lots={view === "alerts" ? alertLots : lots} showAlerts={view === "alerts"} />}
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

function LotsTable({ lots, showAlerts }: { lots: Lot[]; showAlerts: boolean }) {
  return <Card><CardHeader><CardTitle>{showAlerts ? "Batches needing attention" : "Stock by batch"}</CardTitle><p className="mt-1 text-xs text-[#75808d]">Remaining quantity is derived from the batch’s recorded stock movements.</p></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[1100px] border-collapse text-left text-xs"><thead><tr className="border-y border-[#edf0f3] bg-[#fafbfc] text-[10px] uppercase tracking-wide text-[#89929d]"><th className="px-4 py-3">Batch / source</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Weight (g)</th><th className="px-4 py-3">Weight lb</th><th className="px-4 py-3">Purity</th><th className="px-4 py-3">Density</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Cost / g</th><th className="px-4 py-3">Remaining (g)</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{lots.map((lot) => <tr key={lot.id} className="border-b border-[#f0f2f4] text-[#63707e]"><td className="px-4 py-3 font-medium text-[#344151]">{lot.batchNumber || lot.trade?.reference || "—"}<span className="block text-[10px] text-[#87919d]">{lot.source || lot.trade?.reference || "Unknown source"}</span></td><td className="px-4 py-3">{new Date(lot.receivedAt).toLocaleDateString("en-GH")}</td><td className="px-4 py-3">{formatWeight(lot.originalGrams, "g", 2)}</td><td className="px-4 py-3">{lot.pounds === null ? "—" : formatDecimalTruncated(lot.pounds, 2)}</td><td className="px-4 py-3">{formatDecimalTruncated(lot.purityBps / 100, 2)}%</td><td className="px-4 py-3">{lot.density === null ? "—" : formatDecimalTruncated(lot.density, 2)}</td><td className="px-4 py-3">{lot.storageLocation?.name ?? "—"}</td><td className="px-4 py-3">{formatCurrency(Number(lot.costPerGram))}</td><td className="px-4 py-3 font-semibold text-[#344151]">{formatWeight(lot.ledgerBalanceGrams, "g", 2)}</td><td className="px-4 py-3"><Badge tone={lot.cacheMismatch || Number(lot.ledgerBalanceGrams) < 0 ? "red" : lot.status === "DEPLETED" ? "gold" : "green"}>{lot.cacheMismatch ? "Ledger mismatch" : Number(lot.ledgerBalanceGrams) < 0 ? "Negative ledger" : lot.status}</Badge></td></tr>)}</tbody></table>{lots.length === 0 && <p className="p-8 text-center text-xs text-[#89929d]">{showAlerts ? "No stock reconciliation alerts." : "No stock batches have been recorded."}</p>}</CardContent></Card>;
}
