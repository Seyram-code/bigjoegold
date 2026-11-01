"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { formatDecimalTruncated } from "@/lib/decimal-policy";

type Movement = {
  id: string;
  reference: string;
  type: "PURCHASE_RECEIPT" | "SALE_ISSUE" | "SALE_RETURN";
  quantityGrams: string | number;
  movementDate: string;
  trade: { reference: string; customer: { name: string; code: string } | null };
  inventoryLot: { id: string } | null;
  createdBy: { name: string };
};

function errorMessage(body: unknown) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return "Unable to load stock movements";
}

export function StockMovements() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch("/api/inventory/movements", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      setMovements(Array.isArray(body) ? body : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load stock movements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useAutoRefresh(() => load(true));

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium text-[#8b949e]">Workspace / Inventory</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">Stock movements</h1><p className="mt-1.5 text-sm text-[#76808c]">Immutable receipts, sale issues, and returns tied to their trade and inventory batch.</p></div>
      <RefreshButton loading={loading} onClick={() => { void load(); }} />
    </div>
    <AlertDialog open={Boolean(error)} title="Stock movements error" description={error} onConfirm={() => setError("")} />
    <Card>
      <CardHeader><CardTitle>Movement ledger</CardTitle><p className="mt-1 text-[11px] text-[#89929d]">{loading ? "Loading movements…" : `${movements.length} movements shown`}</p></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[850px] border-collapse text-left">
          <thead><tr className="border-y border-[#edf0f3] bg-[#fafbfc] text-[10px] uppercase tracking-wide text-[#89929d]">
            <th className="px-4 py-3">Movement reference</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Trade</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Weight</th><th className="px-4 py-3">Batch</th><th className="px-4 py-3">Recorded by</th>
          </tr></thead>
          <tbody>{movements.map((movement) => <tr key={movement.id} className="border-b border-[#f0f2f4] text-xs text-[#63707e]">
            <td className="px-4 py-3 font-semibold text-[#283544]">{movement.reference}</td>
            <td className="px-4 py-3">{new Date(movement.movementDate).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</td>
            <td className="px-4 py-3"><Badge tone={movement.type === "PURCHASE_RECEIPT" || movement.type === "SALE_RETURN" ? "green" : "red"}>{movement.type === "PURCHASE_RECEIPT" ? "Purchase receipt" : movement.type === "SALE_RETURN" ? "Sale return" : "Sale issue"}</Badge></td>
            <td className="px-4 py-3">{movement.trade.reference}</td>
            <td className="px-4 py-3">{movement.trade.customer?.name ?? "—"}</td>
            <td className="px-4 py-3">{formatDecimalTruncated(movement.quantityGrams, 5)} g</td>
            <td className="px-4 py-3">{movement.inventoryLot ? "Linked" : "Multiple / not applicable"}</td>
            <td className="px-4 py-3">{movement.createdBy.name}</td>
          </tr>)}</tbody>
        </table>
        {!loading && movements.length === 0 && <p className="px-5 py-8 text-center text-xs text-[#89929d]">No stock movements have been recorded.</p>}
      </CardContent>
    </Card>
  </div>;
}
