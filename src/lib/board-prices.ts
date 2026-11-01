import { Prisma } from "@prisma/client";
import "@/lib/decimal-policy";

export const BOARD_PRICE_UNITS = [
  { value: "GHS_PER_GRAM_PURE_GOLD", label: "per gram of pure gold" },
  { value: "GRAM_GROSS", label: "per gram (gross)" },
  { value: "KILOGRAM", label: "per kilogram" },
  { value: "TROY_OUNCE", label: "per troy ounce" },
  { value: "CUSTOM", label: "Other (enter unit)" },
] as const;

export function boardPriceUnitLabel(unit: string) {
  return BOARD_PRICE_UNITS.find((option) => option.value === unit)?.label ?? unit;
}

export type BoardPricePoint = { priceAmount: string | number; currency: string; priceUnit: string; priceType?: string };

export function compareBoardPriceHistory<T extends BoardPricePoint>(prices: T[]) {
  return prices.map((price, index) => {
    const prior = prices.slice(index + 1).find((candidate) =>
      candidate.priceType === price.priceType && candidate.currency === price.currency && candidate.priceUnit === price.priceUnit,
    );
    if (!prior) return { price, prior: null, delta: null, percent: null };
    const currentAmount = new Prisma.Decimal(String(price.priceAmount));
    const priorAmount = new Prisma.Decimal(String(prior.priceAmount));
    const delta = currentAmount.minus(priorAmount).toFixed(6);
    const percent = priorAmount.isZero()
      ? null
      : currentAmount.minus(priorAmount).div(priorAmount).mul(100).toFixed(2);
    return { price, prior, delta, percent };
  });
}
