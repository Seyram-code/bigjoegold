"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type TradingActivityPoint = { date: string; sales: number; purchases: number };

export function TradingActivityChart({ data, loading = false }: { data: TradingActivityPoint[]; loading?: boolean }) {
  const hasActivity = data.some((point) => point.sales > 0 || point.purchases > 0);
  return <Card>
    <CardHeader className="flex-row items-start justify-between"><div><CardTitle>Trading activity</CardTitle><p className="mt-1 text-[11px] text-[#8a939e]">Sales and purchases · Last 30 days</p></div><Badge tone="neutral">GHS</Badge></CardHeader>
    <CardContent>
      {loading ? <div className="h-[285px] animate-pulse rounded-lg bg-[#f5f6f7]" /> : !hasActivity ? <div className="flex h-[285px] flex-col items-center justify-center rounded-lg border border-dashed border-[#e5e8ec] bg-[#fbfbfa] text-center"><span className="text-sm font-semibold text-[#66717d]">No activity in this period</span><span className="mt-1 text-[11px] text-[#9aa2ac]">Posted trades will appear here.</span></div> : <>
        <div className="h-[285px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 3, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bc8c36" stopOpacity={0.18} /><stop offset="95%" stopColor="#bc8c36" stopOpacity={0} /></linearGradient>
                <linearGradient id="blueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6f8aa7" stopOpacity={0.13} /><stop offset="95%" stopColor="#6f8aa7" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#edf0f3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tickLine={false} axisLine={false} tick={{ fill: "#9aa2ac", fontSize: 10 }} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#9aa2ac", fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.trunc(value / 1000)}k` : `${value}`} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={(value) => new Date(String(value)).toLocaleDateString("en-GH", { day: "numeric", month: "short" })} contentStyle={{ border: "1px solid #e8ebef", borderRadius: 10, fontSize: 11, boxShadow: "0 8px 24px rgba(23,33,47,.08)" }} />
              <Area type="monotone" dataKey="sales" name="Sales" stroke="#bc8c36" strokeWidth={2} fill="url(#goldArea)" />
              <Area type="monotone" dataKey="purchases" name="Purchases" stroke="#6f8aa7" strokeWidth={1.8} fill="url(#blueArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex gap-5 text-[10px] text-[#78818d]"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#bc8c36]" /> Sales</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#6f8aa7]" /> Purchases</span></div>
      </>}
    </CardContent>
  </Card>;
}
