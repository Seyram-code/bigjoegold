import { Prisma } from "@prisma/client";
import { formatDecimalTruncated, truncateDecimal } from "@/lib/decimal-policy";

function formatGroupedDecimal(value: string, minimumFractionDigits = 0) {
  const [whole, fraction = ""] = value.split(".");
  const negative = whole.startsWith("-");
  const absoluteWhole = negative ? whole.slice(1) : whole;
  const groupedWhole = new Intl.NumberFormat("en-GH").format(BigInt(absoluteWhole));
  const trimmedFraction = fraction.replace(/0+$/, "");
  const displayedFraction = trimmedFraction.padEnd(minimumFractionDigits, "0");
  return `${negative ? "-" : ""}${groupedWhole}${displayedFraction ? `.${displayedFraction}` : ""}`;
}

export const formatCurrency = (value: number | string, options?: Intl.NumberFormatOptions) => {
  if (!options) return formatCurrencyExact(truncateDecimal(value, 2).toFixed(2, Prisma.Decimal.ROUND_DOWN));
  const maximumFractionDigits = Math.max(0, Math.min(options.maximumFractionDigits ?? 2, 2));
  const truncated = truncateDecimal(value, maximumFractionDigits);
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    ...options,
    minimumFractionDigits: Math.min(options.minimumFractionDigits ?? 0, maximumFractionDigits),
    maximumFractionDigits,
  }).format(Number(truncated));
};

export function formatCurrencyExact(value: string | number, currencyCode = "GHS") {
  const decimal = truncateDecimal(value, 2).toFixed(2, Prisma.Decimal.ROUND_DOWN);
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(decimal);
  if (!match) throw new RangeError("Currency value must be a finite decimal");

  const negative = match[1] === "-";
  const formatter = new Intl.NumberFormat("en-GH", { style: "currency", currency: currencyCode });
  const parts = formatter.formatToParts(negative ? -1 : 1);
  const currency = parts.find((part) => part.type === "currency")?.value ?? "GHS";
  const literal = parts.find((part) => part.type === "literal")?.value ?? " ";
  const sign = negative ? parts.find((part) => part.type === "minusSign")?.value ?? "-" : "";
  const groupedMajor = new Intl.NumberFormat("en-GH").format(BigInt(match[2]));
  return `${sign}${currency}${literal}${groupedMajor}.${match[3]}`;
}

export function formatCurrencyWholeGhsTruncated(value: string | number) {
  const wholeGhs = truncateDecimal(value, 0).toFixed(0, Prisma.Decimal.ROUND_DOWN);
  const negative = wholeGhs.startsWith("-");
  const absoluteGhs = BigInt(negative ? wholeGhs.slice(1) : wholeGhs);
  const groupedGhs = new Intl.NumberFormat("en-GH").format(absoluteGhs);
  return `${negative ? "-" : ""}GHS ${groupedGhs}.00`;
}

export function formatTwoDecimalTruncated(value: string | number) {
  return formatDecimalTruncated(value, 2);
}

export const formatWeight = (value: number | string, unit?: "kg" | "g", precision?: number) => {
  const weight = new Prisma.Decimal(String(value));
  const displayUnit = unit ?? (weight.abs().greaterThanOrEqualTo(1) ? "kg" : "g");
  const displayValue = !unit && displayUnit === "g" ? weight.mul(1000) : weight;
  const displayPrecision = Math.max(0, Math.min(displayUnit === "kg" ? 2 : precision ?? 2, 2));
  const displayNumber = truncateDecimal(displayValue.toString(), displayPrecision)
    .toFixed(displayPrecision, Prisma.Decimal.ROUND_DOWN);
  return `${formatGroupedDecimal(displayNumber, displayUnit === "kg" ? 2 : 0)} ${displayUnit}`;
};

export const formatGoldRate = (value: number | string) => `${formatCurrency(value)} / g`;

export function formatPriceAmount(value: number | string, currency: string) {
  const decimal = truncateDecimal(value, 2).toFixed(2, Prisma.Decimal.ROUND_DOWN);
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(decimal);
  if (!match) throw new RangeError("Price amount must be a finite decimal");
  const major = new Intl.NumberFormat("en-GH").format(BigInt(match[2]));
  const fraction = match[3].replace(/0+$/, "");
  return `${match[1]}${currency} ${major}${fraction ? `.${fraction}` : ""}`;
}
