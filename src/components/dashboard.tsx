"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, CalendarDays,
  Coins, Plus, ShoppingCart, Users, Wallet,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { FormField } from "@/components/ui/form-field";
import { formatCurrency, formatPriceAmount, formatWeight } from "@/lib/formatters";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { formatCompactNumberTruncated, formatDecimalTruncated } from "@/lib/decimal-policy";
import { boardPriceUnitLabel } from "@/lib/board-prices";

type TradeRow = {
  id: string;
  reference: string;
  type: "SALE" | "PURCHASE";
  quantityKg: number;
  totalAmount: number;
  transactionDate: string;
  customerName: string;
};

type DashboardData = {
  period: { from: string; to: string; trendGrouping: "day" | "month" };
  summary: {
    salesInPeriod: number;
    purchasesInPeriod: number;
    salesCount: number;
    purchasesCount: number;
    salesKgInPeriod: number;
    salesGramsInPeriod: number;
    salesDownGramsInPeriod: number;
    salesGramsToday: number;
    salesRevenueToday: number;
    salesPoundsInPeriod: number;
    salesDensityInPeriod: number | null;
    salesKaratInPeriod: number | null;
    purchasesKgInPeriod: number;
    purchasesPoundsInPeriod: number;
    purchasesDownGramsInPeriod: number;
    purchasesDensityInPeriod: number | null;
    purchasesKaratInPeriod: number | null;
    inventoryAverageKarat: number | null;
    customerCount: number;
    inventoryKg: number;
    inventoryValue: number;
    receivable: number;
    payable: number;
    boardPriceAmount: string | null;
    boardPriceCurrency: string;
    boardPriceUnit: string | null;
    receivingBoardPriceAmount: string | null;
    receivingBoardPriceCurrency: string;
    receivingBoardPriceUnit: string | null;
  };
  trend: { date: string; salesKg: number; purchasesKg: number }[];
  inventoryByKarat: { karat: number; kilograms: number }[];
  recentTrades: TradeRow[];
  recentPurchases: TradeRow[];
  recentSales: TradeRow[];
  recentPayments: { id: string; reference: string; direction: "INBOUND" | "OUTBOUND"; amount: number; method: string; paidAt: string; customerName: string | null; allocation: string }[];
  recentStockMovements: { id: string; reference: string; type: string; quantityGrams: number; movementDate: string; batchNumber: string | null; locationName: string | null; tradeReference: string | null; customerName: string | null }[];
  priceHistory: { priceAmount: string; currency: string; priceUnit: string; effectiveAt: string }[];
};

const karatColors = ["#f3ae19", "#b87824", "#875313", "#364558", "#8592a3", "#c5ccd4"];
const chartTooltipStyle = { border: "1px solid #e7ebef", borderRadius: 9, fontSize: 10, boxShadow: "0 8px 24px rgba(23,33,47,.09)" };
const localDateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const todayDateString = () => localDateString(new Date());
const monthStartDateString = () => `${todayDateString().slice(0, 7)}-01`;
const displayDate = (value: string, includeYear: boolean) => new Date(`${value}T00:00:00`).toLocaleDateString("en-GH", {
  day: "2-digit",
  month: "short",
  ...(includeYear ? { year: "numeric" } : {}),
});
const displayDateRange = (from: string, to: string) => {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${displayDate(from, !sameMonth)} – ${displayDate(to, true)}`;
};

export function Dashboard({
  canWriteTrades,
  canWriteCustomers,
  canWriteInventory,
  canReadReports,
}: {
  canWriteTrades: boolean;
  canWriteCustomers: boolean;
  canWriteInventory: boolean;
  canReadReports: boolean;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFrom, setSelectedFrom] = useState(monthStartDateString);
  const [selectedTo, setSelectedTo] = useState(todayDateString);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from: selectedFrom, to: selectedTo });
      const response = await fetch(`/api/dashboard?${params}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        window.location.assign("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load dashboard");
      setError("");
      setData(body as DashboardData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [selectedFrom, selectedTo]);

  const applyDateRange = useCallback((from: string, to: string) => {
    setLoading(true);
    if (from === selectedFrom && to === selectedTo) {
      void load();
      return;
    }
    setSelectedFrom(from);
    setSelectedTo(to);
  }, [load, selectedFrom, selectedTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load);

  if (error) return <div className="mx-auto mt-12 max-w-lg rounded-xl border border-rose-200 bg-white p-7 text-center">
    <Activity className="mx-auto text-rose-600" />
    <h1 className="mt-3 font-semibold text-[#17212f]">Dashboard couldn’t load</h1>
    <AlertDialog open title="Dashboard error" description={error} onConfirm={() => {}} />
    <RefreshButton className="mt-5" loading={loading} label="Try again" onClick={() => { setLoading(true); void load(); }} />
  </div>;

  if (loading || !data) return <div className="space-y-4">
    <div className="h-12 animate-pulse rounded-lg bg-white" />
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[104px] animate-pulse rounded-xl bg-white" />)}</div>
    <div className="h-56 animate-pulse rounded-xl bg-white" />
  </div>;

  const { summary } = data;
  const currentPrice = summary.boardPriceAmount === null ? null : Number(summary.boardPriceAmount);
  const compatiblePrices = data.priceHistory
    .filter((price) => price.currency === summary.boardPriceCurrency && price.priceUnit === summary.boardPriceUnit)
    .map((price) => ({ date: price.effectiveAt, amount: Number(price.priceAmount) }));
  const karatTotal = data.inventoryByKarat.reduce((total, item) => total + item.kilograms, 0);

  const metrics = [
    { label: "Total gold purchased", value: formatWeight(summary.purchasesKgInPeriod), detail: `${summary.purchasesCount} posted in period`, amount: formatCurrency(summary.purchasesInPeriod), icon: ShoppingCart },
    { label: "Total pounds received", value: `${formatDecimalTruncated(summary.purchasesPoundsInPeriod, 2)} lb`, detail: "Selected period", amount: null, icon: BarChart3 },
    { label: "Total down weight", value: `${formatDecimalTruncated(summary.purchasesDownGramsInPeriod, 2)} g`, detail: "Selected period", amount: null, icon: BarChart3 },
    { label: "Average density received", value: summary.purchasesDensityInPeriod === null ? "—" : formatDecimalTruncated(summary.purchasesDensityInPeriod, 2), detail: "Weighted by received grams", amount: null, icon: Coins },
    { label: "Average karat received", value: summary.purchasesKaratInPeriod === null ? "—" : `${formatDecimalTruncated(summary.purchasesKaratInPeriod, 2)}K`, detail: "Weighted by received grams", amount: null, icon: Coins },
    { label: "Total gold sold", value: formatWeight(summary.salesKgInPeriod), detail: `${summary.salesCount} sales recorded in period`, amount: formatCurrency(summary.salesInPeriod), icon: Wallet },
    { label: "Total grams sold", value: `${formatDecimalTruncated(summary.salesGramsInPeriod, 2)} g`, detail: "Selected period", amount: null, icon: BarChart3 },
    { label: "Grams sold today", value: `${formatDecimalTruncated(summary.salesGramsToday, 2)} g`, detail: "Today", amount: formatCurrency(summary.salesRevenueToday), icon: Wallet },
    { label: "Total pounds sold", value: `${formatDecimalTruncated(summary.salesPoundsInPeriod, 2)} lb`, detail: "Selected period", amount: null, icon: BarChart3 },
    { label: "Down weight sold", value: `${formatDecimalTruncated(summary.salesDownGramsInPeriod, 2)} g`, detail: "Selected period", amount: null, icon: BarChart3 },
    { label: "Average density sold", value: summary.salesDensityInPeriod === null ? "—" : formatDecimalTruncated(summary.salesDensityInPeriod, 2), detail: "Weighted by sold grams", amount: null, icon: Coins },
    { label: "Average karat sold", value: summary.salesKaratInPeriod === null ? "—" : `${formatDecimalTruncated(summary.salesKaratInPeriod, 2)}K`, detail: "Weighted by sold grams", amount: null, icon: Coins },
    { label: "Current stock", value: formatWeight(summary.inventoryKg), detail: "Current FIFO inventory value", amount: formatCurrency(summary.inventoryValue), icon: BarChart3 },
    { label: "Current average karat", value: summary.inventoryAverageKarat === null ? "—" : `${formatDecimalTruncated(summary.inventoryAverageKarat, 2)}K`, detail: "Weighted by current stock grams", amount: null, icon: Coins },
    { label: "Total customers", value: summary.customerCount.toLocaleString("en-GH"), detail: "Registered customer accounts", amount: null, icon: Users },
  ];

  return <div className="space-y-2.5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-.035em] text-[#111820]">Dashboard</h1>
        <p className="mt-0.5 text-[13px] text-[#637083]">Overview of your gold trading business</p>
      </div>
      <DashboardDateRange from={selectedFrom} to={selectedTo} busy={loading} onApply={applyDateRange} />
    </div>

    <section aria-label="Selected period business totals and current snapshot" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(({ label, value, detail, amount, icon: Icon }) => <Card key={label} className="rounded-[10px]">
        <CardContent className="flex min-h-[102px] items-start gap-3 p-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-[#292311] text-[#FFD43B]"><Icon size={22} strokeWidth={2.2} /></span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[10px] font-medium text-[#5e6a7a]">{label}</p>
            <p className="mt-1 truncate text-[19px] font-bold leading-tight tabular-nums text-[#101820]">{value}</p>
            <p className="mt-1 truncate text-[9px] text-[#788494]">{amount ?? detail}</p>
            {amount && <p className="mt-0.5 truncate text-[9px] text-[#788494]">{detail}</p>}
          </div>
        </CardContent>
      </Card>)}
    </section>

    <section className="grid gap-2 xl:grid-cols-[1.36fr_1.12fr_.94fr]">
      <PurchaseSalesTrend data={data.trend} grouping={data.period.trendGrouping} />
      <StockByKarat data={data.inventoryByKarat} total={summary.inventoryKg} />
      <RecentStockMovements rows={data.recentStockMovements} />
    </section>

    <section className="grid gap-2 xl:grid-cols-[1fr_1fr_.72fr]">
      <RecentTrades title="Recent gold purchases" type="PURCHASE" rows={data.recentPurchases} />
      <RecentTrades title="Recent gold sales" type="SALE" rows={data.recentSales} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <PriceHistory
          currentPrice={currentPrice}
          currency={summary.boardPriceCurrency}
          unit={summary.boardPriceUnit}
          history={compatiblePrices}
        />
        <QualityDistribution data={data.inventoryByKarat} total={karatTotal} />
      </div>
    </section>

    <section aria-label="Quick actions" className="space-y-2 pt-0.5">
      <h2 className="text-[13px] font-bold text-[#1c2734]">Quick actions</h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {canWriteTrades && <QuickAction href="/receive-stock" label="Receive gold" description="Buy gold from customers" icon={Plus} primary />}
        {canWriteTrades && <QuickAction href="/sales/new-sale" label="New sale" description="Sell gold to buyers" icon={ShoppingCart} />}
        {canWriteInventory && <QuickAction href="/add-stock/opening-stock" label="Add stock" description="Opening stock or adjustment" icon={BarChart3} />}
        {canWriteCustomers && <QuickAction href="/customers" label="Add customer" description="Register a new customer" icon={Users} />}
      </div>
    </section>

    <section className="grid gap-2 xl:grid-cols-[1fr_1fr]">
      <Balances summary={summary} />
      <RecentPayments rows={data.recentPayments} />
    </section>
    {canReadReports && <div className="flex justify-end"><Link href="/reports" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#94651d] hover:underline">Open reports <ArrowRight size={12} /></Link></div>}
    <p className="text-right text-[9px] text-[#8792a0]">Period totals · {displayDateRange(data.period.from, data.period.to)} · Stock, balances, and customer count are current.</p>
  </div>;
}

function DashboardDateRange({ from, to, onApply, busy }: { from: string; to: string; onApply: (from: string, to: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const panelRef = useRef<HTMLDivElement>(null);
  const today = todayDateString();

  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function apply() {
    if (!draftFrom || !draftTo || draftFrom > draftTo || draftTo > today) return;
    onApply(draftFrom, draftTo);
    setOpen(false);
  }

  return <div ref={panelRef} className="relative">
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setOpen((current) => !current)}
      className="flex items-center gap-2 rounded-lg border border-[#dfe5ec] bg-white px-3 py-2 text-[11px] font-medium text-[#344151] shadow-sm hover:border-[#bc8c36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bc8c36]"
    >
      <CalendarDays size={14} className="text-[#667486]" />
      <span>{displayDateRange(from, to)}</span>
    </button>
    {open && <div role="dialog" aria-label="Choose dashboard date range" className="absolute right-0 top-[calc(100%+8px)] z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[#dfe5ec] bg-white p-4 shadow-xl">
      <div className="grid gap-3">
        <FormField label="From" htmlFor="dashboard-date-from">
          <CalendarPicker id="dashboard-date-from" value={draftFrom} onChange={(value) => {
            setDraftFrom(value);
            if (value > draftTo) setDraftTo(value);
          }} max={draftTo} />
        </FormField>
        <FormField label="To" htmlFor="dashboard-date-to">
          <CalendarPicker id="dashboard-date-to" value={draftTo} onChange={setDraftTo} min={draftFrom} max={today} />
        </FormField>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => { setDraftFrom(today); setDraftTo(today); }} className="rounded-md px-2 py-1.5 text-xs font-medium text-[#795719] hover:bg-[#fbf6e9]">Today</button>
          <button type="button" onClick={() => { setDraftFrom(monthStartDateString()); setDraftTo(today); }} className="rounded-md px-2 py-1.5 text-xs font-medium text-[#795719] hover:bg-[#fbf6e9]">This month</button>
        </div>
        <button type="button" disabled={busy || !draftFrom || !draftTo || draftFrom > draftTo || draftTo > today} onClick={apply} className="rounded-lg bg-[#292311] px-3 py-2 text-xs font-semibold text-[#ffd43b] hover:bg-[#3a3018] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Updating…" : "Apply range"}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-[#7b8793]">Defaults to this month through today. Stock and balances remain current.</p>
    </div>}
  </div>;
}

function PurchaseSalesTrend({ data, grouping }: { data: DashboardData["trend"]; grouping: DashboardData["period"]["trendGrouping"] }) {
  const points = data.filter((point) => point.purchasesKg > 0 || point.salesKg > 0);
  const periodLabel = grouping === "day" ? "daily" : "monthly";
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1 pt-2.5">
      <div><CardTitle className="text-[13px]">Purchase &amp; sales trend (KG)</CardTitle><p className="mt-0.5 text-[9px] text-[#85909e]">Gold weight · {periodLabel} in selected period</p></div>
      <Link href="/reports" aria-label="View purchase and sales reports" className="text-[10px] font-semibold text-[#9a6a1d] hover:underline">View reports</Link>
    </CardHeader>
    <CardContent className="px-2 pb-2">
      {points.length ? <>
        <div className="h-[154px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 7, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short" })} tickLine={false} axisLine={false} tick={{ fill: "#8b96a4", fontSize: 8 }} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#8b96a4", fontSize: 8 }} />
              <Tooltip formatter={(value) => formatWeight(Number(value))} labelFormatter={(value) => new Date(`${String(value)}T00:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })} contentStyle={chartTooltipStyle} />
              <Line type="monotone" dataKey="purchasesKg" name="Purchased (KG)" stroke="#f0a500" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="salesKg" name="Sold (KG)" stroke="#7c9dbd" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartLegend entries={[["#f0a500", "Purchased (KG)"], ["#7c9dbd", "Sold (KG)"]]} />
      </> : <EmptyState>No purchase or sales activity in the selected period.</EmptyState>}
    </CardContent>
  </Card>;
}

function StockByKarat({ data, total }: { data: DashboardData["inventoryByKarat"]; total: number }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="px-3 pb-1 pt-2.5"><CardTitle className="text-[13px]">Stock by karat</CardTitle></CardHeader>
    <CardContent className="grid min-h-[184px] items-center gap-1 px-2 pb-2 sm:grid-cols-[1.06fr_1fr]">
      {data.length ? <>
        <div className="relative mx-auto h-[164px] w-full max-w-[190px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={data} dataKey="kilograms" nameKey="karat" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="white" strokeWidth={1}>
              {data.map((entry, index) => <Cell key={entry.karat} fill={karatColors[index % karatColors.length]} />)}
            </Pie><Tooltip formatter={(value) => formatWeight(Number(value))} labelFormatter={(value) => `${value}K`} contentStyle={chartTooltipStyle} /></PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[14px] font-bold tabular-nums text-[#18212d]">{formatWeight(total)}</span>
            <span className="text-[9px] text-[#687586]">Total stock</span>
          </div>
        </div>
        <div className="space-y-2 px-1">
          {data.map((entry, index) => {
            const share = total > 0 ? entry.kilograms / total * 100 : 0;
            return <div key={entry.karat} className="flex items-center justify-between gap-2 text-[9px]">
              <span className="flex items-center gap-1.5 text-[#526073]"><i className="size-2 rounded-full" style={{ backgroundColor: karatColors[index % karatColors.length] }} />{entry.karat}K</span>
              <span className="whitespace-nowrap tabular-nums text-[#48576a]">{formatWeight(entry.kilograms)} <span className="text-[#8b95a2]">({formatDecimalTruncated(share, 1)}%)</span></span>
            </div>;
          })}
        </div>
      </> : <EmptyState>No gold is currently available.</EmptyState>}
    </CardContent>
  </Card>;
}

function RecentStockMovements({ rows }: { rows: DashboardData["recentStockMovements"] }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1 pt-2.5">
      <CardTitle className="text-[13px]">Recent stock movements</CardTitle>
      <Link href="/inventory/stock-movements" aria-label="View all stock movements" className="rounded-md border border-[#e5e9ed] p-1 text-[#576476] hover:bg-[#f6f7f8]"><ArrowRight size={13} /></Link>
    </CardHeader>
    <CardContent className="space-y-0 px-3 pb-1">
      {rows.length ? rows.map((row) => {
        const incoming = row.type.endsWith("_IN") || row.type === "PURCHASE_RECEIPT" || row.type === "OPENING_BALANCE" || row.type === "SALE_RETURN";
        return <div key={row.id} className="flex min-h-[42px] items-center gap-2 border-t border-[#edf0f3] py-1.5 first:border-0">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${incoming ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{incoming ? <ArrowDownToLine size={14} /> : <ArrowUpRight size={14} />}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[9px] font-semibold text-[#273342]">{movementTitle(row.type)}{row.customerName ? ` · ${row.customerName}` : row.tradeReference ? ` · ${row.tradeReference}` : ""}</p>
            <p className="truncate text-[8px] text-[#8893a0]">{row.batchNumber ? `Batch ${row.batchNumber}` : row.locationName ?? row.reference} · {new Date(row.movementDate).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}</p>
          </div>
          <span className="shrink-0 text-[9px] font-bold tabular-nums text-[#2a3542]">{formatWeight(row.quantityGrams / 1000)}</span>
        </div>;
      }) : <EmptyState>No stock movements recorded yet.</EmptyState>}
    </CardContent>
  </Card>;
}

function RecentTrades({ title, type, rows }: { title: string; type: "PURCHASE" | "SALE"; rows: TradeRow[] }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1.5 pt-2.5">
      <CardTitle className="text-[13px]">{title}</CardTitle>
      <Link href={type === "PURCHASE" ? "/transactions/purchases" : "/transactions/sales"} className="rounded-md border border-[#e5e9ed] px-2 py-1 text-[9px] font-semibold text-[#253142] hover:bg-[#f6f7f8]">View all</Link>
    </CardHeader>
    <CardContent className="overflow-x-auto px-2 pb-2">
      <table className="w-full min-w-[380px] text-left">
        <thead><tr className="bg-[#f7f8fa] text-[8px] font-bold uppercase text-[#475366]"><th className="px-1.5 py-2">Date</th><th className="px-1.5 py-2">{type === "PURCHASE" ? "Customer" : "Buyer"}</th><th className="px-1.5 py-2">KG</th><th className="px-1.5 py-2">Amount (GHS)</th><th className="px-1.5 py-2">Status</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => <tr key={row.id} className="border-b border-[#f0f2f4] last:border-0">
            <td className="whitespace-nowrap px-1.5 py-2 text-[9px] text-[#566274]">{new Date(row.transactionDate).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}</td>
            <td className="max-w-[100px] truncate px-1.5 py-2 text-[9px] text-[#344151]" title={row.customerName}>{row.customerName}</td>
            <td className="whitespace-nowrap px-1.5 py-2 text-[9px] tabular-nums text-[#344151]">{formatWeight(row.quantityKg)}</td>
            <td className="whitespace-nowrap px-1.5 py-2 text-[9px] font-semibold tabular-nums text-[#273342]">{formatCurrency(row.totalAmount)}</td>
            <td className="px-1.5 py-2"><span className="rounded-md bg-emerald-50 px-1.5 py-1 text-[8px] font-semibold text-emerald-700">Posted</span></td>
          </tr>) : <tr><td className="py-7 text-center text-[10px] text-[#929ba6]" colSpan={5}>No {type.toLowerCase()}s recorded.</td></tr>}
        </tbody>
      </table>
    </CardContent>
  </Card>;
}

function PriceHistory({ currentPrice, currency, unit, history }: { currentPrice: number | null; currency: string; unit: string | null; history: { date: string; amount: number }[] }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1 pt-2.5">
      <div><CardTitle className="text-[13px]">Gold price history</CardTitle>{currentPrice !== null && <p className="mt-0.5 text-[9px] font-semibold text-[#263445]">{formatPriceAmount(currentPrice, currency)} <span className="font-normal text-[#7e8997]">/ {unit ? boardPriceUnitLabel(unit) : "unit"}</span></p>}</div>
      <Link href="/gold-price/history" className="rounded-md border border-[#e5e9ed] px-2 py-1 text-[9px] font-semibold text-[#253142] hover:bg-[#f6f7f8]">View all</Link>
    </CardHeader>
    <CardContent className="px-2 pb-2">
      {history.length > 1 ? <div className="h-[112px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 3, right: 4, left: -18, bottom: 0 }}>
            <defs><linearGradient id="priceHistoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f0a500" stopOpacity={0.24} /><stop offset="100%" stopColor="#f0a500" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid stroke="#edf0f3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value: string) => new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short" })} tickLine={false} axisLine={false} tick={{ fill: "#8792a0", fontSize: 8 }} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: "#8792a0", fontSize: 8 }} tickFormatter={(value: number) => formatCompactNumberTruncated(value)} />
            <Tooltip formatter={(value) => formatPriceAmount(Number(value), currency)} labelFormatter={(value) => new Date(String(value)).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })} contentStyle={chartTooltipStyle} />
            <Area type="monotone" dataKey="amount" stroke="#f0a500" strokeWidth={1.8} fill="url(#priceHistoryFill)" dot={{ r: 2, fill: "#f0a500" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div> : <EmptyState>{currentPrice === null ? "No published gold price yet." : "More price changes will appear here."}</EmptyState>}
    </CardContent>
  </Card>;
}

function QualityDistribution({ data, total }: { data: DashboardData["inventoryByKarat"]; total: number }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1 pt-2.5">
      <CardTitle className="text-[12px]">Gold quality distribution</CardTitle>
      <Link href="/inventory/current-stock" className="text-[9px] font-semibold text-[#9a6a1d] hover:underline">View details</Link>
    </CardHeader>
    <CardContent className="space-y-1.5 px-3 pb-3">
      {data.length ? data.slice(0, 5).map((entry, index) => {
        const share = total > 0 ? entry.kilograms / total * 100 : 0;
        return <div key={entry.karat} className="grid grid-cols-[42px_1fr_34px_48px] items-center gap-1.5 text-[8px] text-[#526073]">
          <span>{entry.karat}K</span><span className="h-2 overflow-hidden rounded-full bg-[#f2f3f4]"><i className="block h-full rounded-full" style={{ width: `${share}%`, backgroundColor: karatColors[index % karatColors.length] }} /></span><span className="text-right tabular-nums">{formatDecimalTruncated(share, 1)}%</span><span className="text-right tabular-nums">{formatWeight(entry.kilograms)}</span>
        </div>;
      }) : <p className="py-2 text-center text-[9px] text-[#929ba6]">No inventory to classify.</p>}
    </CardContent>
  </Card>;
}

function QuickAction({ href, label, description, icon: Icon, primary = false }: { href: string; label: string; description: string; icon: typeof Plus; primary?: boolean }) {
  return <Link href={href} className={`flex min-h-[58px] items-center gap-2.5 rounded-[10px] border p-2 transition hover:-translate-y-0.5 hover:shadow-sm ${primary ? "border-[#f0c04c] bg-gradient-to-r from-[#ffe29b] to-[#f4bd38]" : "border-[#e6eaee] bg-white hover:border-[#e2c578]"}`}>
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-[9px] ${primary ? "bg-[#efb526] text-[#171b20]" : "bg-[#ffda7a] text-[#292311]"}`}><Icon size={19} strokeWidth={2.2} /></span>
    <span className="min-w-0"><span className="block truncate text-[10px] font-bold text-[#202a37]">{label}</span><span className="mt-0.5 block truncate text-[8px] text-[#657183]">{description}</span></span>
  </Link>;
}

function Balances({ summary }: { summary: DashboardData["summary"] }) {
  const balances = [
    ["Customer receivables", summary.receivable],
    ["Supplier payables", summary.payable],
  ] as const;
  return <Card className="rounded-[10px]">
    <CardHeader className="px-3 pb-1 pt-2.5"><CardTitle className="text-[13px]">Outstanding balances</CardTitle></CardHeader>
    <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-3">
      {balances.map(([label, value]) => <div key={label} className="rounded-lg bg-[#f8f9fa] px-3 py-2"><p className="text-[9px] text-[#768292]">{label}</p><p className="mt-1 text-[12px] font-bold tabular-nums text-[#263342]">{formatCurrency(value)}</p></div>)}
    </CardContent>
  </Card>;
}

function RecentPayments({ rows }: { rows: DashboardData["recentPayments"] }) {
  return <Card className="rounded-[10px]">
    <CardHeader className="flex-row items-center justify-between px-3 pb-1 pt-2.5"><CardTitle className="text-[13px]">Recent payments</CardTitle><Link href="/transactions/payments" className="text-[9px] font-semibold text-[#9a6a1d] hover:underline">View all</Link></CardHeader>
    <CardContent className="overflow-x-auto px-2 pb-2">
      <table className="w-full min-w-[420px] text-left"><thead><tr className="bg-[#f7f8fa] text-[8px] font-bold uppercase text-[#657183]"><th className="px-2 py-1.5">Reference</th><th className="px-2 py-1.5">Direction</th><th className="px-2 py-1.5">Record</th><th className="px-2 py-1.5">Amount</th></tr></thead>
        <tbody>{rows.length ? rows.slice(0, 4).map((row) => <tr key={row.id} className="border-b border-[#f0f2f4] last:border-0"><td className="px-2 py-1.5 text-[9px] font-semibold text-[#344151]">{row.reference}</td><td className="px-2 py-1.5 text-[9px] text-[#596779]">{row.direction === "INBOUND" ? "Received" : "Paid"}</td><td className="max-w-[120px] truncate px-2 py-1.5 text-[9px] text-[#596779]">{row.customerName ?? row.allocation}</td><td className="whitespace-nowrap px-2 py-1.5 text-[9px] font-semibold text-[#344151]">{formatCurrency(row.amount)}</td></tr>) : <tr><td colSpan={4} className="py-5 text-center text-[9px] text-[#929ba6]">No payments recorded yet.</td></tr>}</tbody>
      </table>
    </CardContent>
  </Card>;
}

function ChartLegend({ entries }: { entries: [string, string][] }) {
  return <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1.5">{entries.map(([color, label]) => <span key={label} className="flex items-center gap-1.5 text-[8px] text-[#627083]"><i className="size-2 rounded-sm" style={{ backgroundColor: color }} />{label}</span>)}</div>;
}

function movementTitle(type: string) {
  if (type.includes("RECEIPT") || type.includes("OPENING")) return "Received stock";
  if (type.includes("SALE") || type.endsWith("_OUT")) return "Stock issued";
  if (type.includes("TRANSFER")) return "Stock transferred";
  if (type.includes("CORRECTION")) return "Stock corrected";
  return type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[70px] items-center justify-center rounded-lg border border-dashed border-[#e5e8ec] px-3 py-4 text-center text-[9px] text-[#929ba6]">{children}</div>;
}
