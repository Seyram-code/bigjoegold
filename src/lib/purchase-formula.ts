export type PurchaseFormulaRules = {
  version: string;
  ownerConfirmed: boolean;
  poundsKgDivisor: string;
  densityReference: string;
  karatMultiplier: string;
  karatDiscountMultiplier: string;
  amountKaratDivisor: string;
  priceUnit: string;
};

export const MAX_PURCHASE_KARAT = "24";
export const PURCHASE_FORMULA_VERSION = "BJG-RECEIVING-3.0.0";

export const DEFAULT_PURCHASE_FORMULA_RULES: PurchaseFormulaRules = {
  version: PURCHASE_FORMULA_VERSION,
  ownerConfirmed: false,
  poundsKgDivisor: "7.75",
  densityReference: "10.51",
  karatMultiplier: "52.838",
  karatDiscountMultiplier: "0.993",
  amountKaratDivisor: "23",
  priceUnit: "GHS_PER_GRAM_PURE_GOLD",
};

type StoredPurchaseFormula = {
  version: string;
  ownerConfirmed: boolean;
  poundsKgDivisor: { toString(): string };
  densityReference: { toString(): string };
  karatMultiplier: { toString(): string };
  karatDiscountMultiplier: { toString(): string };
  amountKaratDivisor: { toString(): string };
};

export function purchaseFormulaRules(stored?: StoredPurchaseFormula | null): PurchaseFormulaRules {
  if (!stored) return DEFAULT_PURCHASE_FORMULA_RULES;
  return {
    version: stored.version,
    ownerConfirmed: stored.ownerConfirmed && stored.version === PURCHASE_FORMULA_VERSION,
    poundsKgDivisor: stored.poundsKgDivisor.toString(),
    densityReference: stored.densityReference.toString(),
    karatMultiplier: stored.karatMultiplier.toString(),
    karatDiscountMultiplier: stored.karatDiscountMultiplier.toString(),
    amountKaratDivisor: stored.amountKaratDivisor.toString(),
    priceUnit: DEFAULT_PURCHASE_FORMULA_RULES.priceUnit,
  };
}
