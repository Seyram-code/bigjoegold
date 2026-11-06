"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { fieldControlClass } from "@/components/ui/form-field";

export type SavedContactOption = {
  id: string;
  name: string;
  phone: string | null;
};

export function SavedContactAutocomplete({
  id,
  contacts,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  contacts: SavedContactOption[];
  value: string;
  onChange: (contactId: string) => void;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = contacts.find((contact) => contact.id === value);
  const selectedLabel = selected ? `${selected.name}${selected.phone ? ` · ${selected.phone}` : ""}` : "";
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? contacts.filter((contact) => [contact.name, contact.phone ?? ""]
        .some((field) => field.toLocaleLowerCase().includes(normalized)))
      : contacts;
  }, [contacts, query]);

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

  function selectContact(contactId: string) {
    onChange(contactId);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) showOptions();
      else setActiveIndex((index) => Math.min(index + 1, results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (activeIndex === 0) selectContact("");
      else if (results[activeIndex - 1]) selectContact(results[activeIndex - 1].id);
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
          aria-label="Saved contact (optional)"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : selectedLabel}
          placeholder="Search saved contacts by name or number"
          onFocus={() => { if (!open) showOptions(); }}
          onClick={() => { if (!open) showOptions(); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`${fieldControlClass} pl-10 pr-16 ${open ? "border-[#bc8c36] ring-4 ring-[#bc8c36]/10" : ""}`}
        />
        {value && !disabled && <button
          type="button"
          aria-label="Clear saved contact"
          onClick={() => {
            selectContact("");
            inputRef.current?.focus();
          }}
          className="absolute right-9 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#8e99a5] transition hover:bg-[#f3f5f7] hover:text-[#5b6673]"
        ><X size={14} /></button>}
        <button
          type="button"
          aria-label={open ? "Close saved contact suggestions" : "Open saved contact suggestions"}
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
        ><ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} /></button>
      </div>
      {open && <div
        id={`${id}-options`}
        role="listbox"
        aria-label="Saved contacts"
        className="absolute left-0 right-0 top-[calc(100%+6px)] z-[90] max-h-72 overflow-y-auto rounded-xl border border-[#e5e9ee] bg-white p-1.5 shadow-[0_16px_40px_rgba(23,33,47,.16)]"
      >
        <button
          id={`${id}-option-0`}
          type="button"
          role="option"
          aria-selected={!value}
          onMouseEnter={() => setActiveIndex(0)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectContact("")}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs ${!value ? "bg-[#f8e6b0] ring-1 ring-inset ring-[#d6aa42]" : activeIndex === 0 ? "bg-[#fbf6eb]" : "hover:bg-[#f8f9fa]"}`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f1f3f5] text-[#697586]"><UserRound size={15} /></span>
          <span className="min-w-0 flex-1 truncate font-medium text-[#576373]">Enter contact manually</span>
          {!value && <Check size={15} className="shrink-0 text-[#9a6a1d]" />}
        </button>
        {results.map((contact, index) => {
          const optionIndex = index + 1;
          return <button
            id={`${id}-option-${optionIndex}`}
            key={contact.id}
            type="button"
            role="option"
            aria-selected={contact.id === value}
            onMouseEnter={() => setActiveIndex(optionIndex)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectContact(contact.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${contact.id === value ? "bg-[#f8e6b0] ring-1 ring-inset ring-[#d6aa42]" : optionIndex === activeIndex ? "bg-[#fbf6eb]" : "hover:bg-[#f8f9fa]"}`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f5e3b0] text-[#795719]"><UserRound size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[#293442]">{contact.name}</span>
              <span className="mt-0.5 block truncate text-[10px] text-[#8994a1]">{contact.phone || "No phone number saved"}</span>
            </span>
            {contact.id === value && <Check size={15} className="shrink-0 text-[#9a6a1d]" />}
          </button>;
        })}
        {results.length === 0 && <div className="px-3 py-5 text-center">
          <Search size={18} className="mx-auto mb-2 text-[#aeb6bf]" />
          <p className="text-xs font-medium text-[#576373]">No matching saved contacts</p>
        </div>}
      </div>}
      {selected && <p className="mt-1.5 text-xs text-[#89929d]">Customer number: {selected.phone || "No phone number saved"}</p>}
    </div>
  );
}
