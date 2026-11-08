import { Prisma } from "@prisma/client";
import { formatDecimalTruncated, truncateDecimal } from "@/lib/decimal-policy";

export const formatCurrency = (value: number | string, options?: Intl.NumberFormatOptions) => {
  const truncated = truncateDecimal(value, 2);
  if (!options) return formatCurrencyExact(truncated.toFixed(2, Prisma.Decimal.ROUND_DOWN));
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    ...options,
    maximumFractionDigits: 2,
  }).format(Number(truncated));
};

export function formatCurrencyExact(value: string | number) {
  const decimal = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) throw new RangeError("Currency value must be a finite decimal");

  const minorUnits = BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").slice(0, 2).padEnd(2, "0"));
  const negative = match[1] === "-";
  const absoluteMinorUnits = minorUnits;
  const majorUnits = absoluteMinorUnits / BigInt(100);
  const fraction = (absoluteMinorUnits % BigInt(100)).toString().padStart(2, "0");
  const formatter = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" });
  const parts = formatter.formatToParts(negative ? -1 : 1);
  const currency = parts.find((part) => part.type === "currency")?.value ?? "GHS";
  const literal = parts.find((part) => part.type === "literal")?.value ?? " ";
  const sign = negative ? parts.find((part) => part.type === "minusSign")?.value ?? "-" : "";
  const groupedMajor = new Intl.NumberFormat("en-GH").format(majorUnits);
  return `${sign}${currency}${literal}${groupedMajor}.${fraction}`;
}

export function formatCurrencyWholeGhsTruncated(value: string | number) {
  const wholeGhs = truncateDecimal(value, 0).toFixed(0, Prisma.Decimal.ROUND_DOWN);
  const negative = wholeGhs.startsWith("-");
  const absoluteGhs = BigInt(negative ? wholeGhs.slice(1) : wholeGhs);
  const groupedGhs = new Intl.NumberFormat("en-GH").format(absoluteGhs);
  return `${negative ? "-" : ""}GHS ${groupedGhs}.00`;
}

export function formatTwoDecimalTruncated(value: string | number) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) throw new RangeError("Measurement value must be a finite decimal");
  return `${match[1]}${match[2]}.${(match[3] ?? "").padEnd(2, "0").slice(0, 2)}`;
}

export const formatWeight = (value: number | string, unit?: "kg" | "g", precision?: number) => {
  const weight = new Prisma.Decimal(String(value));
  const displayUnit = unit ?? (weight.abs().greaterThanOrEqualTo(1) ? "kg" : "g");
  const displayValue = !unit && displayUnit === "g" ? weight.mul(1000) : weight;
  const displayPrecision = Math.min(displayUnit === "kg" ? 2 : precision ?? 2, 2);
  return `${new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: displayUnit === "kg" ? 2 : 0,
    maximumFractionDigits: displayPrecision,
  }).format(Number(formatDecimalTruncated(displayValue.toString(), displayPrecision)))} ${displayUnit}`;
};

export const formatGoldRate = (value: number | string) => `${formatCurrency(value)} / g`;

export function formatPriceAmount(value: number | string, currency: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) throw new RangeError("Price amount must be a finite decimal");
  const major = new Intl.NumberFormat("en-GH").format(BigInt(match[2]));
  const fraction = (match[3] ?? "").slice(0, 2).replace(/0+$/, "");
  return `${match[1]}${currency} ${major}${fraction ? `.${fraction}` : ""}`;
}
