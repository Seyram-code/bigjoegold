"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { fieldControlClass } from "@/components/ui/form-field";
import { formatWeight } from "@/lib/formatters";

export type StockOption = {
  id: string;
  source?: string;
  batchNumber: string;
  receivedAt: string;
  grams: string | number;
};

function optionLabel(stock: StockOption) {
  return `${stock.source || "Unknown source"} · ${stock.batchNumber} · ${new Date(stock.receivedAt).toLocaleDateString("en-GH")} · ${formatWeight(stock.grams, "g", 2)}`;
}

export function StockAutocomplete({
  id,
  lots,
  value,
  onChange,
  placeholder = "Search stock batches",
  required = false,
  disabled = false,
}: {
  id: string;
  lots: StockOption[];
  value: string;
  onChange: (lotId: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = lots.find((lot) => lot.id === value);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matches = normalized
      ? lots.filter((lot) => optionLabel(lot).toLocaleLowerCase().includes(normalized))
      : lots;
    return matches.slice(0, 50);
  }, [lots, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function showOptions() {
    if (disabled) return;
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function selectLot(lot: StockOption) {
    onChange(lot.id);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) showOptions();
      else setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      selectLot(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a2ae]" />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={open ? query : selected ? optionLabel(selected) : ""}
          placeholder={placeholder}
          onFocus={() => { if (!open) showOptions(); }}
          onClick={() => { if (!open) showOptions(); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`${fieldControlClass} pl-10 pr-10`}
        />
        <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#98a2ae]" />
      </div>
      {open && <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[#dfe4e9] bg-white p-1 shadow-lg">
        <ul id={`${id}-options`} role="listbox" aria-label="Stock batches">
          {results.map((lot, index) => <li key={lot.id}>
            <button
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={lot.id === value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectLot(lot)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs ${lot.id === value ? "bg-[#f8e6b0] font-semibold text-[#263241] ring-1 ring-inset ring-[#d6aa42]" : index === activeIndex ? "bg-[#fbf6eb] text-[#263241]" : "text-[#344151] hover:bg-[#fafbfc]"}`}
            >
              <span className="min-w-0 truncate">{optionLabel(lot)}</span>
              {lot.id === value && <Check aria-hidden="true" size={14} className="shrink-0 text-[#9a6a1d]" />}
            </button>
          </li>)}
          {results.length === 0 && <li className="px-3 py-2 text-xs text-[#89929d]">No matching stock batches.</li>}
        </ul>
      </div>}
      {selected && <p className="mt-1.5 text-xs text-[#89929d]">Available: {formatWeight(selected.grams, "g", 2)}</p>}
    </div>
  );
}
