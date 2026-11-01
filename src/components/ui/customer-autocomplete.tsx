"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { fieldControlClass } from "@/components/ui/form-field";

export type CustomerOption = {
  id: string;
  name: string;
  code: string;
  phone?: string | null;
};

export function CustomerAutocomplete({
  id,
  customers,
  value,
  onChange,
  placeholder = "Search customers by name or ID",
  required = false,
  disabled = false,
  className,
}: {
  id: string;
  customers: CustomerOption[];
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = customers.find((customer) => customer.id === value);
  const selectedLabel = selected ? `${selected.name} (${selected.code})` : "";
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matches = normalized
      ? customers.filter((customer) => [customer.name, customer.code, customer.phone ?? ""]
        .some((field) => field.toLocaleLowerCase().includes(normalized)))
      : customers;
    return matches.slice(0, 50);
  }, [customers, query]);

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

  function selectCustomer(customer: CustomerOption) {
    onChange(customer.id);
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
      selectCustomer(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a2ae]" />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          onFocus={() => {
            if (!open) showOptions();
          }}
          onClick={() => {
            if (!open) showOptions();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`${fieldControlClass} pl-10 pr-16 ${open ? "border-[#bc8c36] ring-4 ring-[#bc8c36]/10" : ""} ${className ?? ""}`}
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="Clear selected customer"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-9 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#8e99a5] transition hover:bg-[#f3f5f7] hover:text-[#5b6673]"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label={open ? "Close customer suggestions" : "Open customer suggestions"}
          aria-controls={`${id}-options`}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (open) setOpen(false);
            else {
              showOptions();
              inputRef.current?.focus();
            }
          }}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[#8994a1] transition hover:bg-[#f7f8fa] hover:text-[#8a611f] disabled:cursor-not-allowed"
        >
          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div
          id={`${id}-options`}
          role="listbox"
          aria-label="Matching customers"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[90] max-h-72 overflow-y-auto rounded-xl border border-[#e5e9ee] bg-white p-1.5 shadow-[0_16px_40px_rgba(23,33,47,.16)]"
        >
          {results.length ? results.map((customer, index) => (
            <button
              id={`${id}-option-${index}`}
              key={customer.id}
              type="button"
              role="option"
              aria-selected={customer.id === value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCustomer(customer)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${customer.id === value ? "bg-[#f8e6b0] ring-1 ring-inset ring-[#d6aa42]" : index === activeIndex ? "bg-[#fbf6eb]" : "hover:bg-[#f8f9fa]"}`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f5e3b0] text-[#795719]"><UserRound size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#293442]">{customer.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[#8994a1]">{customer.code}{customer.phone ? ` · ${customer.phone}` : ""}</span>
              </span>
              {customer.id === value && <Check size={15} className="shrink-0 text-[#9a6a1d]" />}
            </button>
          )) : (
            <div className="px-3 py-6 text-center">
              <Search size={18} className="mx-auto mb-2 text-[#aeb6bf]" />
              <p className="text-xs font-medium text-[#576373]">No matching customers</p>
              <p className="mt-1 text-[10px] text-[#98a2ae]">Try a different name, customer ID, or phone number.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
