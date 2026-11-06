import { Prisma } from "@prisma/client";
import { calculateGoldMeasurements } from "@/lib/gold";
import type { PurchaseFormulaRules } from "@/lib/purchase-formula";

export function calculateMansoBranchPurchase(
  topGramsInput: string | number,
  downGramsInput: string | number,
  actualCostInput: string | number,
  rules: PurchaseFormulaRules,
) {
  const actualCost = new Prisma.Decimal(actualCostInput);
  if (!actualCost.isFinite() || !actualCost.greaterThan(0)) {
    throw new RangeError("Enter a valid actual purchase cost greater than zero");
  }
  const measurements = calculateGoldMeasurements(topGramsInput, downGramsInput, rules);
  const inventoryGrams = measurements.topGrams.toDecimalPlaces(5);
  if (inventoryGrams.greaterThan("999999999.99999")) {
    throw new RangeError("Top weight exceeds the supported inventory range");
  }
  if (measurements.downGrams.greaterThan("999999999.99999")) {
    throw new RangeError("Down weight exceeds the supported measurement range");
  }
  const purityBps = measurements.karat.div(24).mul(10000)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  const pureGrams = inventoryGrams.mul(purityBps).div(10000);
  const pricePerGram = actualCost.div(pureGrams).toDecimalPlaces(6);
  const costPerGram = actualCost.div(inventoryGrams).toDecimalPlaces(6);
  if (pricePerGram.greaterThan("999999999999.999999") || costPerGram.greaterThan("99999999.999999")) {
    throw new RangeError("Actual cost is outside the supported per-gram price range");
  }
  return {
    measurements,
    actualCost,
    purityBps,
    pricePerGram,
    costPerGram,
    inventoryGrams,
  };
}
