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
  return `${stock.source || "Unknown source"} · ${new Date(stock.receivedAt).toLocaleDateString("en-GH")} · ${formatWeight(stock.grams, "g", 2)}`;
}

type StockAutocompleteProps = {
  id: string;
  lots: StockOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
} & (
  | { multiple: true; value: string[]; onChange: (lotIds: string[]) => void }
  | { multiple?: false; value: string; onChange: (lotId: string) => void }
);

export function StockAutocomplete(props: StockAutocompleteProps) {
  const { id, lots, placeholder = "Search stock batches", required = false, disabled = false } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const multiple = props.multiple === true;
  const selectedIds = multiple ? props.value : props.value ? [props.value] : [];
  const selected = multiple ? undefined : lots.find((lot) => lot.id === props.value);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matches = normalized
      ? lots.filter((lot) => optionLabel(lot).toLocaleLowerCase().includes(normalized))
      : lots;
    return matches;
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
    if (props.multiple) {
      props.onChange(props.value.includes(lot.id)
        ? props.value.filter((id) => id !== lot.id)
        : [...props.value, lot.id]);
      return;
    }
    props.onChange(lot.id);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) showOptions();
      else setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
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
          value={open ? query : multiple ? (props.value.length ? `${props.value.length} batches selected` : "") : selected ? optionLabel(selected) : ""}
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
        {results.length > 0 && <p className="px-3 py-2 text-[10px] text-[#89929d]">{results.length} available {results.length === 1 ? "batch" : "batches"} · scroll to browse</p>}
        <ul id={`${id}-options`} role="listbox" aria-label="Stock batches" aria-multiselectable={multiple}>
          {results.map((lot, index) => <li key={lot.id}>
            <button
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={selectedIds.includes(lot.id)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectLot(lot)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${selectedIds.includes(lot.id) ? "bg-[#f8e6b0] font-semibold text-[#263241] ring-1 ring-inset ring-[#d6aa42]" : index === activeIndex ? "bg-[#fbf6eb] text-[#263241]" : "text-[#344151] hover:bg-[#fafbfc]"}`}
            >
              {multiple && <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded border ${selectedIds.includes(lot.id) ? "border-[#9a6a1d] bg-white text-[#9a6a1d]" : "border-[#aab2bd] bg-white"}`}>{selectedIds.includes(lot.id) && <Check size={12} />}</span>}
              <span className="min-w-0 flex-1 truncate">{optionLabel(lot)}</span>
              {!multiple && selectedIds.includes(lot.id) && <Check aria-hidden="true" size={14} className="shrink-0 text-[#9a6a1d]" />}
            </button>
          </li>)}
          {results.length === 0 && <li className="px-3 py-2 text-xs text-[#89929d]">No matching stock batches.</li>}
        </ul>
      </div>}
      {!multiple && selected && <p className="mt-1.5 text-xs text-[#89929d]">Available: {formatWeight(selected.grams, "g", 2)}</p>}
    </div>
  );
}
