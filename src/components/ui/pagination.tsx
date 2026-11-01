import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f3] px-5 py-3">
      <p className="text-[11px] text-[#89929d]">Showing <span className="font-semibold text-[#52606d]">{start}–{end}</span> of <span className="font-semibold text-[#52606d]">{total}</span></p>
      <div className="flex items-center gap-1">
        <Button aria-label="Previous page" variant="ghost" size="icon" className="size-8" onClick={() => onPageChange(page - 1)} disabled={page <= 1}><ChevronLeft size={15} /></Button>
        <span className="min-w-14 text-center text-[11px] font-medium text-[#66717d]">{page} / {pageCount}</span>
        <Button aria-label="Next page" variant="ghost" size="icon" className="size-8" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}><ChevronRight size={15} /></Button>
      </div>
    </div>
  );
}
