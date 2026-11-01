import { Prisma } from "@prisma/client";

Prisma.Decimal.set({ rounding: Prisma.Decimal.ROUND_DOWN });

export function truncateDecimal(value: number | string, decimalPlaces: number) {
  const truncated = new Prisma.Decimal(String(value)).toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_DOWN);
  return truncated.isZero() ? new Prisma.Decimal(0) : truncated;
}

export function formatDecimalTruncated(value: number | string, decimalPlaces: number) {
  return truncateDecimal(value, decimalPlaces).toFixed(decimalPlaces, Prisma.Decimal.ROUND_DOWN);
}

export function formatCompactNumberTruncated(value: number | string) {
  const decimal = new Prisma.Decimal(String(value));
  const absolute = decimal.abs();
  const units = [
    { threshold: new Prisma.Decimal("1000000000000"), divisor: new Prisma.Decimal("1000000000000"), suffix: "T" },
    { threshold: new Prisma.Decimal("1000000000"), divisor: new Prisma.Decimal("1000000000"), suffix: "B" },
    { threshold: new Prisma.Decimal("1000000"), divisor: new Prisma.Decimal("1000000"), suffix: "M" },
    { threshold: new Prisma.Decimal("1000"), divisor: new Prisma.Decimal("1000"), suffix: "K" },
  ];
  const unit = units.find(({ threshold }) => absolute.greaterThanOrEqualTo(threshold));
  if (!unit) return decimal.toFixed(0, Prisma.Decimal.ROUND_DOWN);
  return `${decimal.div(unit.divisor).toFixed(1, Prisma.Decimal.ROUND_DOWN)}${unit.suffix}`;
}
