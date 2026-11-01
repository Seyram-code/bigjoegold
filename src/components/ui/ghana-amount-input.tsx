"use client";

import { useEffect, useRef, useState } from "react";

function normalizeAmount(value: string, decimalScale: number) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const decimalIndex = cleaned.indexOf(".");
  const integer = (decimalIndex < 0 ? cleaned : cleaned.slice(0, decimalIndex)).replace(/\./g, "");
  if (decimalIndex < 0) return integer;
  const fraction = cleaned.slice(decimalIndex + 1).replace(/\./g, "").slice(0, decimalScale);
  return `${integer}.${fraction}`;
}

function formatAmount(value: string) {
  if (!value) return "";
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function GhanaAmountInput({
  value,
  onChange,
  decimalScale = 2,
  onBlur,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  decimalScale?: number;
}) {
  const [displayValue, setDisplayValue] = useState(() => formatAmount(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayValue(formatAmount(value));
  }, [value]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const caret = input.selectionStart ?? input.value.length;
    const logicalCaret = input.value.slice(0, caret).replace(/,/g, "").length;
    const nextValue = normalizeAmount(input.value, decimalScale);
    const nextDisplay = formatAmount(nextValue);
    setDisplayValue(nextDisplay);
    onChange(nextValue);

    let nextCaret = 0;
    let seen = 0;
    while (nextCaret < nextDisplay.length && seen < logicalCaret) {
      if (nextDisplay[nextCaret] !== ",") seen += 1;
      nextCaret += 1;
    }
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCaret, nextCaret));
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const normalized = normalizeAmount(displayValue, decimalScale).replace(/\.$/, "");
    setDisplayValue(formatAmount(normalized));
    if (normalized !== value) onChange(normalized);
    onBlur?.(event);
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
