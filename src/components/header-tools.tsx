"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Coins, FileText, LoaderCircle, Users, WalletCards, X } from "lucide-react";
import { formatCurrency, formatPriceAmount, formatWeight } from "@/lib/formatters";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { AlertDialog } from "@/components/ui/alert-dialog";

type Results = {
  customers: { id: string; name: string; code: string; phone: string | null }[];
  trades: { id: string; reference: string; type: "SALE" | "PURCHASE"; quantityKg: number; totalAmount: number; customer: { name: string } | null }[];
  payments: { id: string; reference: string; direction: "INBOUND" | "OUTBOUND"; amount: number; method: string; trade: { reference: string } | null }[];
};

const emptyResults: Results = { customers: [], trades: [], payments: [] };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(emptyResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(emptyResults);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json() as Results & { error?: string };
        if (!response.ok) throw new Error(body.error || "Search is unavailable");
        setResults(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search is unavailable");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const total = results.customers.length + results.trades.length + results.payments.length;
  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={root} className="relative min-w-0 flex-1 lg:max-w-[420px]">
      <div className="relative">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setOpen(true); }} placeholder="Search customers, transactions, reference no…" className="[&_input]:h-9 [&_input]:border-white/[.08] [&_input]:bg-[#1c2939] [&_input]:text-[11px] [&_input]:text-white [&_input]:placeholder:text-[#a9b3c0] [&_input]:focus:border-[#d7b76f] [&_input]:focus:bg-[#1c2939]" />
        <kbd className="pointer-events-none absolute right-3 hidden rounded border border-white/[.08] bg-[#283548] px-1.5 py-0.5 text-[9px] font-medium text-[#c1cad4] sm:inline-flex">Ctrl + K</kbd>
      </div>
      {open && <div className="absolute left-0 right-0 top-11 z-[60] overflow-hidden rounded-xl border border-[#e4e8ec] bg-white shadow-[0_20px_60px_rgba(23,33,47,.16)]">
        <div className="flex items-center justify-between border-b border-[#edf0f3] px-4 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#929ba6]">Workspace search</p><button onClick={close} aria-label="Close search" className="rounded p-1 text-[#929ba6] hover:bg-[#f1f3f5]"><X size={13} /></button></div>
        {query.trim().length < 2 ? <p className="px-4 py-7 text-center text-xs text-[#929ba6]">Type at least two characters to search records.</p>
          : loading ? <p className="flex items-center justify-center gap-2 px-4 py-7 text-xs text-[#7c8692]"><LoaderCircle size={14} className="animate-spin" /> Searching records…</p>
            : error ? null
              : total === 0 ? <p className="px-4 py-7 text-center text-xs text-[#929ba6]">No matching customers, trades, or payments.</p>
                : <div className="max-h-[390px] overflow-y-auto p-2">
                  {results.customers.length > 0 && <SearchGroup title="Customers" icon={<Users size={13} />}>{results.customers.map((customer) => <Link key={customer.id} href="/customers" onClick={close} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-[#faf7f0]"><span className="min-w-0"><span className="block truncate text-xs font-semibold text-[#293442]">{customer.name}</span><span className="mt-1 block text-[10px] text-[#8c96a1]">{customer.code}{customer.phone ? ` · ${customer.phone}` : ""}</span></span><Badge tone="neutral">Customer</Badge></Link>)}</SearchGroup>}
                  {results.trades.length > 0 && <SearchGroup title="Trades" icon={<Coins size={13} />}>{results.trades.map((trade) => <Link key={trade.id} href="/trades" onClick={close} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-[#faf7f0]"><span className="min-w-0"><span className="block truncate text-xs font-semibold text-[#293442]">{trade.reference} <span className="font-normal text-[#87919c]">· {trade.customer?.name ?? "Walk-in"}</span></span><span className="mt-1 block text-[10px] text-[#8c96a1]">{formatWeight(trade.quantityKg)} · {formatCurrency(trade.totalAmount)}</span></span><Badge tone={trade.type === "SALE" ? "green" : "blue"}>{trade.type}</Badge></Link>)}</SearchGroup>}
                  {results.payments.length > 0 && <SearchGroup title="Payments" icon={<WalletCards size={13} />}>{results.payments.map((payment) => <Link key={payment.id} href="/payments" onClick={close} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-[#faf7f0]"><span><span className="block text-xs font-semibold text-[#293442]">{payment.reference}</span><span className="mt-1 block text-[10px] text-[#8c96a1]">{payment.trade?.reference ?? payment.method}</span></span><span className="text-xs font-semibold text-[#293442]">{formatCurrency(payment.amount)}</span></Link>)}</SearchGroup>}
                </div>}
      </div>}
      <AlertDialog open={Boolean(error)} title="Search error" description={error} onConfirm={() => setError("")} />
    </div>
  );
}

function SearchGroup({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="mb-1 last:mb-0"><h3 className="flex items-center gap-2 px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[.12em] text-[#a0a8b1]">{icon}{title}</h3>{children}</section>;
}

export function MarketPriceIndicator() {
  const [prices, setPrices] = useState<{
    receiving: { amount: string; currency: string } | null;
    selling: { amount: string; currency: string } | null;
  }>({ receiving: null, selling: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/board-prices?current=1", { cache: "no-store" });
      const body = await response.json() as {
        receiving: { amount: string; currency: string } | null;
        selling: { amount: string; currency: string } | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Unable to load current board price");
      setPrices({ receiving: body.receiving, selling: body.selling });
      setError(false);
      setLoaded(true);
    } catch {
      setError(true);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useAutoRefresh(refresh);

  return <>
    <Link
      href="/gold-price/current-board-price"
      title={error ? "Board prices are temporarily unavailable. Retrying automatically." : "View receiving and selling gold board prices"}
      className="hidden w-[218px] items-center gap-2 rounded-lg border border-[#b88d24] bg-[#292313] px-2 py-1 sm:flex"
    >
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#f3c548]"><Coins size={18} /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-[8px] font-medium text-[#d9d2c3]">Gold board prices · per pure gram</span>
      <span className="mt-0.5 grid grid-cols-2 gap-2">
        <span className="min-w-0">
          <span className="block text-[7px] text-[#ded7c8]">Receiving</span>
          <span className="block truncate whitespace-nowrap text-[10px] font-bold tabular-nums text-[#ffd344]">{!loaded ? "Loading…" : error ? "Unavailable" : prices.receiving ? formatPriceAmount(prices.receiving.amount, prices.receiving.currency) : "Not set"}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[7px] text-[#ded7c8]">Selling</span>
          <span className="block truncate whitespace-nowrap text-[10px] font-bold tabular-nums text-[#ffd344]">{!loaded ? "Loading…" : error ? "Unavailable" : prices.selling ? formatPriceAmount(prices.selling.amount, prices.selling.currency) : "Not set"}</span>
        </span>
      </span>
    </span>
    </Link>
    <span className="sr-only" aria-live="polite">
      {loaded && error ? "Unable to load current board prices. Retrying automatically." : ""}
    </span>
  </>;
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<{ receivable: number; payable: number; inventoryKg: number } | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load workspace alerts");
      setSummary(body.summary);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load workspace alerts");
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
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

  const count = summary ? Number(summary.receivable > 0) + Number(summary.payable > 0) : 0;
  return <div ref={root} className="relative">
    <button aria-label="Notifications" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative flex size-9 items-center justify-center rounded-lg text-[#d6dee8] transition hover:bg-white/[.08]">
      <Bell size={17} />
      {count > 0 && <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-rose-600 text-[8px] font-bold text-white">{count}</span>}
    </button>
    {open && <div className="absolute right-0 top-11 z-[60] w-[min(340px,calc(100vw-24px))] rounded-xl border border-[#e5e8ec] bg-white p-4 shadow-[0_18px_50px_rgba(23,33,47,.16)]">
      <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold text-[#17212f]">Desk notifications</h2><p className="mt-1 text-[10px] text-[#929ba6]">Live balances that may need attention</p></div><button onClick={() => setOpen(false)} aria-label="Close notifications" className="rounded p-1 text-[#929ba6] hover:bg-[#f1f3f5]"><X size={14} /></button></div>
      {error ? null : !summary ? <p className="mt-5 flex items-center gap-2 text-xs text-[#8b949e]"><LoaderCircle size={13} className="animate-spin" /> Loading balances…</p> : <div className="mt-4 space-y-1">
        <AlertLink href="/trades" label="Customer receivables" value={summary.receivable} tone="gold" />
        <AlertLink href="/trades" label="Purchase payables" value={summary.payable} tone="blue" />
        <div className="flex items-center justify-between rounded-lg bg-[#f7f8fa] px-3 py-2.5"><span className="flex items-center gap-2 text-[11px] text-[#66717d]"><FileText size={13} /> Available inventory</span><span className="text-[11px] font-semibold text-[#293442]">{formatWeight(summary.inventoryKg)}</span></div>
      </div>}
    </div>}
    <AlertDialog open={Boolean(error)} title="Notifications error" description={error} onConfirm={() => setError("")} />
  </div>;
}

function AlertLink({ href, label, value, tone }: { href: string; label: string; value: number; tone: "gold" | "blue" | "rose" }) {
  const color = tone === "gold" ? "text-[#9a6a1d]" : tone === "blue" ? "text-blue-700" : "text-rose-700";
  return <Link href={href} className="flex items-center justify-between rounded-lg px-3 py-2.5 transition hover:bg-[#f7f8fa]"><span className="flex items-center gap-2 text-[11px] text-[#66717d]"><span className={`size-1.5 rounded-full ${tone === "gold" ? "bg-[#bc8c36]" : tone === "blue" ? "bg-blue-500" : "bg-rose-500"}`} />{label}</span><span className={`text-[11px] font-semibold ${color}`}>{formatCurrency(value)}</span></Link>;
}
