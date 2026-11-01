"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  children,
  emptyMessage = "Nothing recorded here yet.",
  pageSize = 12,
  loading = false,
  extraColumn = false,
}: {
  columns: { label: string; key: string }[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  children: (row: T, index: number) => React.ReactNode;
  emptyMessage?: string;
  pageSize?: number;
  loading?: boolean;
  extraColumn?: boolean;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left">
          <thead><tr className="border-y border-[#edf0f3] text-[10px] font-semibold uppercase tracking-wide text-[#929ba6]">
            {columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 first:pl-5">{column.label}</th>)}
            {extraColumn && <th className="px-4 py-3">Actions</th>}
          </tr></thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }, (_, index) => <tr key={`loading-${index}`} className="border-b border-[#f0f2f4]">{columns.map((column) => <td key={column.key} className="px-4 py-4"><span className="block h-3 animate-pulse rounded bg-[#f0f2f4]" /></td>)}</tr>)
              : rows.length
                ? rows.slice((page - 1) * pageSize, page * pageSize).map((row, index) => <tr key={rowKey(row, index)} className="border-b border-[#f0f2f4] align-middle last:border-0 hover:bg-[#fbfaf7]">{children(row, index)}</tr>)
                : <tr><td colSpan={columns.length + Number(extraColumn)} className="px-4 py-14 text-center"><span className="mx-auto flex size-10 items-center justify-center rounded-full bg-[#f5e3b0] text-[#795719]"><FileText size={18} /></span><p className="mt-3 text-xs font-medium text-[#66717d]">{emptyMessage}</p><p className="mt-1 text-[10px] text-[#9aa2ac]">Your workspace will show records here as activity is posted.</p></td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && <Pagination page={page} pageCount={pageCount} total={rows.length} pageSize={pageSize} onPageChange={setPage} />}
    </>
  );
}
