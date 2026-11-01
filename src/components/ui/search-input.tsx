"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search records",
  className,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-3 text-[#96a0ac]" size={15} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-10 w-full rounded-lg border border-[#dfe4e9] bg-white pl-9 pr-9 text-xs text-[#293442] outline-none transition focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 rounded p-1 text-[#9ba3ad] hover:bg-[#f1f3f5]">
          <X size={13} />
        </button>
      )}
    </label>
  );
}
