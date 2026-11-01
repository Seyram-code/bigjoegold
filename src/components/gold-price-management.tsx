"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { GhanaAmountInput } from "@/components/ui/ghana-amount-input";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { BOARD_PRICE_UNITS, boardPriceUnitLabel, compareBoardPriceHistory } from "@/lib/board-prices";
import { formatPriceAmount } from "@/lib/formatters";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { boardPriceSchema } from "@/lib/validation";
import { useToast } from "@/components/ui/toast-provider";

type BoardPrice = {
  id: string;
  priceType: "RECEIVING" | "SELLING";
  priceAmount: string | number;
  currency: string;
  priceUnit: string;
  source: string;
  note: string | null;
  effectiveAt: string;
  createdAt: string;
  createdBy: { id: string; name: string };
};

type Section = "current" | "history" | "settings";

const localDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const dateTime = (value: string) => new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });

export function GoldPriceManagement({ section, canWrite }: { section: Section; canWrite: boolean }) {
  const { success: showToast } = useToast();
  const [prices, setPrices] = useState<BoardPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [priceType, setPriceType] = useState<"RECEIVING" | "SELLING">("RECEIVING");
  const [currency, setCurrency] = useState("GHS");
  const [priceUnit, setPriceUnit] = useState<string>(BOARD_PRICE_UNITS[0].value);
  const [customUnit, setCustomUnit] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(localDateTime);

  const loadPrices = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const response = await fetch("/api/board-prices", { cache: "no-store" });
      const body = await response.json() as BoardPrice[] | { prices?: BoardPrice[]; error?: string };
      if (!response.ok) throw new Error(!Array.isArray(body) ? body.error || "Could not load gold board price history" : "Could not load gold board price history");
      setPrices(Array.isArray(body) ? body : body.prices ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load gold board price history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPrices(); }, [loadPrices]);
  useAutoRefresh(() => loadPrices(true));

  const currentByType = {
    RECEIVING: prices.find((price) => price.priceType === "RECEIVING") ?? null,
    SELLING: prices.find((price) => price.priceType === "SELLING") ?? null,
  };
  const current = currentByType[priceType];
  const resolvedUnit = priceUnit === "CUSTOM" ? customUnit.trim() : priceUnit;
  const comparableChanges = compareBoardPriceHistory(prices);

  async function publish() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        priceType,
        priceAmount,
        currency: currency.trim().toUpperCase(),
        priceUnit: resolvedUnit,
        source,
        note,
        effectiveAt: new Date(effectiveAt).toISOString(),
        expectedCurrentPriceId: current?.id ?? null,
      };
      const checked = boardPriceSchema.parse(payload);
      const response = await fetch("/api/board-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not publish the board price");
      showToast(`${priceType === "RECEIVING" ? "Receiving" : "Selling"} board price published successfully.`);
      setConfirming(false);
      setPriceAmount("");
      setSource("");
      setNote("");
      await loadPrices();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish the board price");
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const nav: { id: Section; label: string; href: string }[] = [
    { id: "current", label: "Current price", href: "/gold-price/current-board-price" },
    { id: "history", label: "Price history", href: "/gold-price/history" },
    { id: "settings", label: "Price settings", href: "/gold-price/settings" },
  ];

  return <div className="space-y-6">
    <div><p className="text-xs font-medium text-[#8b949e]">Gold price management</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">{section === "history" ? "Board price history" : section === "settings" ? "Price settings" : "Current board prices"}</h1><p className="mt-1.5 text-sm text-[#76808c]">Maintain separate rates for gold received from suppliers and gold released or sold to buyers.</p></div>
    <nav aria-label="Gold price pages" className="flex gap-2 border-b border-[#e8ebef]">
      {nav.map((item) => <Link key={item.id} href={item.href} aria-current={item.id === section ? "page" : undefined} className={`border-b-2 px-3 py-2.5 text-xs font-semibold transition ${item.id === section ? "border-[#bc8c36] bg-[#f8e6b0] text-[#17212f]" : "border-transparent text-[#7b8590] hover:bg-[#fff8e6] hover:text-[#293442]"}`}>{item.label}</Link>)}
    </nav>

    <AlertDialog open={Boolean(error)} title="Gold price error" description={error} onConfirm={() => setError("")} />
    {section !== "history" && <div className="grid gap-4 lg:grid-cols-2">{(["RECEIVING", "SELLING"] as const).map((type) => {
      const latest = currentByType[type];
      return <Card key={type} className="border-[#d6aa42] bg-[#fff0c2]">
        <CardHeader><CardTitle>{type === "RECEIVING" ? "Receiving stock price" : "Releasing / selling price"}</CardTitle></CardHeader>
        <CardContent>{loading ? <p className="text-xs text-[#89929d]">Loading current price…</p> : latest ? <>
          <p className="text-2xl font-semibold text-[#17212f]">{formatPriceAmount(latest.priceAmount, latest.currency)} <span className="text-sm font-medium text-[#7d8792]">/ {boardPriceUnitLabel(latest.priceUnit)}</span></p>
          <p className="mt-2 text-xs text-[#7c8692]">Effective {dateTime(latest.effectiveAt)} · {latest.source} · recorded by {latest.createdBy.name}</p>
          {latest.note && <p className="mt-1 text-xs text-[#8b949e]">{latest.note}</p>}
        </> : <p className="text-sm text-[#89929d]">No {type === "RECEIVING" ? "receiving" : "selling"} price published yet.</p>}</CardContent>
      </Card>;
    })}</div>}

    {section === "current" && <Card>
      <CardHeader><CardTitle>{current ? "Publish a replacement price" : "Set the first board price"}</CardTitle><p className="text-xs text-[#89929d]">Publishing appends a new historical record; it never edits a rate already used by a purchase.</p></CardHeader>
      <CardContent>
        {canWrite ? <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FormField label="Price applies to" htmlFor="board-type"><select id="board-type" value={priceType} onChange={(event) => setPriceType(event.target.value as "RECEIVING" | "SELLING")} className={fieldControlClass}><option value="RECEIVING">Receiving stock</option><option value="SELLING">Releasing / selling gold</option></select></FormField>
          <FormField label="Price amount" htmlFor="board-amount"><GhanaAmountInput id="board-amount" required min="0.000001" step="0.000001" decimalScale={6} value={priceAmount} onChange={setPriceAmount} className={fieldControlClass} placeholder="e.g. 2,500.000000" /></FormField>
          <FormField label="Currency (ISO 4217)" htmlFor="board-currency"><input id="board-currency" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className={fieldControlClass} /></FormField>
          <FormField label="Quoted price unit" htmlFor="board-unit" hint="Select the exact unit used by the source, or enter a clear custom unit.">
            <select id="board-unit" value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} className={fieldControlClass}>{BOARD_PRICE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select>
          </FormField>
          {priceUnit === "CUSTOM" && <FormField label="Custom price unit" htmlFor="board-custom-unit"><input id="board-custom-unit" required maxLength={80} value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} className={fieldControlClass} placeholder="e.g. USD per 10 g refined gold" /></FormField>}
          <FormField label="Effective date and time" htmlFor="board-effective"><CalendarPicker id="board-effective" includeTime required max={localDateTime()} value={effectiveAt} onChange={setEffectiveAt} /></FormField>
          <FormField label="Source" htmlFor="board-source"><input id="board-source" required minLength={2} maxLength={80} value={source} onChange={(event) => setSource(event.target.value)} className={fieldControlClass} placeholder="e.g. Approved desk rate" /></FormField>
          <FormField label="Note" htmlFor="board-note" className="sm:col-span-2 xl:col-span-3"><textarea id="board-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={`${fieldControlClass} h-20 py-2`} placeholder="Optional context or source reference" /></FormField>
          <div className="sm:col-span-2 xl:col-span-3"><Button type="submit" variant="gold" disabled={saving || loading}>{current ? "Review price replacement" : "Review and publish price"}</Button></div>
        </form> : <p className="text-xs text-[#7c8692]">You have read-only access. Ask an authorized manager to publish a price.</p>}
      </CardContent>
    </Card>}

    {section === "settings" && <Card><CardHeader><CardTitle>Unit and currency safeguards</CardTitle></CardHeader><CardContent className="space-y-3 text-xs leading-5 text-[#6f7985]">
      <p>Each price record stores whether it applies to receiving or selling, plus its currency, exact quoted-unit label, source, effective time, and publisher. Comparisons are shown only for the same direction, currency, and unit.</p>
      <p>Purchases retain a snapshot of the selected price and unit. Updating this board never revises an existing purchase.</p>
      <AlertDialog open title="Price configuration warning" variant="warning" description="Receiving and selling calculations each require their own compatible GHS_PER_GRAM_PURE_GOLD price. Other currencies and units are excluded until an explicit compatible conversion rule is configured." onConfirm={() => {}} />
    </CardContent></Card>}

    {section !== "current" && <Card>
      <CardHeader className="flex-row items-center justify-between"><div><CardTitle><span className="inline-flex items-center gap-2"><History size={15} /> Historical price changes</span></CardTitle><p className="mt-1 text-[11px] text-[#89929d]">Change comparisons use the previous rate with the same currency and unit only.</p></div><RefreshButton loading={loading} onClick={() => void loadPrices()} /></CardHeader>
      <CardContent>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr className="border-b border-[#e8ebef] text-[10px] uppercase tracking-wide text-[#929ba6]"><th className="py-3 pr-3">Effective</th><th className="py-3 pr-3">Direction</th><th className="py-3 pr-3">Price</th><th className="py-3 pr-3">Unit</th><th className="py-3 pr-3">Change</th><th className="py-3 pr-3">Source / note</th><th className="py-3">Recorded by</th></tr></thead><tbody>
          {comparableChanges.map(({ price, prior, delta, percent }) => {
            const direction = delta === null ? 0 : Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
            const percentPrefix = percent !== null && Number(percent) > 0 ? "+" : "";
            return <tr key={price.id} className="border-b border-[#f0f2f4] last:border-0">
              <td className="py-3 pr-3 text-[#687380]">{dateTime(price.effectiveAt)}</td>
              <td className="py-3 pr-3 text-[#687380]">{price.priceType === "RECEIVING" ? "Receiving stock" : "Releasing / selling"}</td>
              <td className="py-3 pr-3 font-semibold text-[#293442]">{formatPriceAmount(price.priceAmount, price.currency)}</td>
              <td className="py-3 pr-3 text-[#687380]">{boardPriceUnitLabel(price.priceUnit)}</td>
              <td className="py-3 pr-3">
                {!prior ? <span className="text-[#929ba6]">No comparable prior rate</span> : <span className={`inline-flex items-center gap-1 ${direction > 0 ? "text-emerald-700" : direction < 0 ? "text-rose-700" : "text-[#75808b]"}`}>
                  {direction > 0 ? <TrendingUp size={12} /> : direction < 0 ? <TrendingDown size={12} /> : null}
                  {direction > 0 ? "+" : ""}{formatPriceAmount(delta!, price.currency)}
                  {percent !== null && <span>({percentPrefix}{percent}%)</span>}
                </span>}
              </td>
              <td className="py-3 pr-3 text-[#687380]">{price.source}{price.note ? ` · ${price.note}` : ""}</td>
              <td className="py-3 text-[#687380]">{price.createdBy.name}</td>
            </tr>;
          })}
          {!loading && prices.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[#929ba6]">No published prices yet.</td></tr>}
        </tbody></table></div>
      </CardContent>
    </Card>}

    <ConfirmDialog
      open={confirming}
      title={current ? "Confirm board price replacement" : "Confirm first board price"}
      description={`Publish ${priceAmount || "—"} ${currency.toUpperCase()} / ${boardPriceUnitLabel(resolvedUnit || "custom unit")} for ${priceType === "RECEIVING" ? "receiving stock" : "releasing / selling gold"} from ${source || "the selected source"}? This creates a new historical price record. Existing transactions will not be changed.`}
      confirmLabel="Confirm and publish"
      busy={saving}
      onCancel={() => setConfirming(false)}
      onConfirm={() => { void publish(); }}
    />
  </div>;
}
