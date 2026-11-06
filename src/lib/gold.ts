import { Prisma } from "@prisma/client";
import "@/lib/decimal-policy";
import { DEFAULT_PURCHASE_FORMULA_RULES, MAX_PURCHASE_KARAT, type PurchaseFormulaRules } from "@/lib/purchase-formula";

export const PURCHASE_CALCULATION_RULES = DEFAULT_PURCHASE_FORMULA_RULES;

function calculateGoldMeasurementsFromDecimals(topGrams: Prisma.Decimal, downGrams: Prisma.Decimal, rules: PurchaseFormulaRules) {
  const pounds = topGrams.div(rules.poundsKgDivisor)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const exactDensity = topGrams.div(downGrams);
  const density = exactDensity.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const baseKarat = density
    .minus(rules.densityReference)
    .mul(rules.karatMultiplier)
    .div(density)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const karat = baseKarat
    .mul(rules.karatDiscountMultiplier)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  if (karat.greaterThan(MAX_PURCHASE_KARAT)) {
    throw new RangeError("Calculated karat exceeds 24. Verify the top and down weights; pure gold is 24 karat.");
  }
  const purity = karat.div(24).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (![pounds, exactDensity, density, karat, purity].every((value) => value.isFinite())) {
    throw new RangeError("Purchase measurements must produce finite values");
  }
  if (!pounds.greaterThan(0) || !density.greaterThan(0) || !karat.greaterThan(0)) {
    throw new RangeError("The entered measurements produce a non-positive karat or purchase amount");
  }
  if (exactDensity.greaterThan("9999999999999999.99999999")) {
    throw new RangeError("The calculated density exceeds the supported storage range");
  }
  return { topGrams, downGrams, pounds, density, karat, purity };
}

export function calculateGoldMeasurements(
  topGramsInput: number | string,
  downGramsInput: number | string,
  rules: PurchaseFormulaRules = PURCHASE_CALCULATION_RULES,
) {
  return calculateGoldMeasurementsFromDecimals(
    positiveDecimal(topGramsInput, "Top weight"),
    positiveDecimal(downGramsInput, "Down weight"),
    rules,
  );
}

export function calculatePurchaseMeasurements(
  topGramsInput: number | string,
  downGramsInput: number | string,
  boardPriceInput: number | string,
  rules: PurchaseFormulaRules = PURCHASE_CALCULATION_RULES,
) {
  const topGrams = positiveDecimal(topGramsInput, "Top weight");
  const downGrams = positiveDecimal(downGramsInput, "Down weight");
  const boardPrice = positiveDecimal(boardPriceInput, "Gold board price");
  const measurements = calculateGoldMeasurementsFromDecimals(topGrams, downGrams, rules);
  const amount = measurements.karat
    .mul(boardPrice)
    .div(rules.amountKaratDivisor)
    .mul(measurements.pounds)
    .toDecimalPlaces(2);
  if (!amount.isFinite()) throw new RangeError("Purchase amount must be finite");
  if (!amount.greaterThan(0)) throw new RangeError("The entered measurements produce a non-positive purchase amount");
  if (amount.greaterThan("99999999999999.99")) {
    throw new RangeError("The calculated purchase amount exceeds the supported storage range");
  }
  return { ...measurements, boardPrice, amount };
}

export function calculateMeasuredSaleQuote(
  topGrams: number | string,
  downGrams: number | string,
  sellingPrice: number | string,
  discountAmount: number | string = "0",
  rules: PurchaseFormulaRules = PURCHASE_CALCULATION_RULES,
) {
  const measurements = calculatePurchaseMeasurements(topGrams, downGrams, sellingPrice, rules);
  const discount = new Prisma.Decimal(discountAmount);
  if (!discount.isFinite() || discount.isNegative() || discount.decimalPlaces() > 2) {
    throw new RangeError("Discount must be a valid non-negative amount in pesewas");
  }
  if (discount.greaterThanOrEqualTo(measurements.amount)) {
    throw new RangeError("Discount must be less than the calculated sale value");
  }
  const purityBps = measurements.karat.div(24).mul(10000)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return {
    ...measurements,
    purityBps,
    subtotal: measurements.amount,
    discount,
    total: measurements.amount.minus(discount),
  };
}

export function inferSaleDownWeightFromReceipts(
  allocations: { lotId: string; grams: Prisma.Decimal | string | number }[],
  lots: {
    id: string;
    purchaseMeasurement?: {
      topKg: Prisma.Decimal | string | number;
      downKg: Prisma.Decimal | string | number;
    } | null;
  }[],
) {
  if (allocations.length === 0) return null;
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  let totalDownGrams = new Prisma.Decimal(0);

  for (const allocation of allocations) {
    const measurement = lotById.get(allocation.lotId)?.purchaseMeasurement;
    if (!measurement) return null;
    const topGrams = new Prisma.Decimal(measurement.topKg).mul(1000);
    const downGrams = new Prisma.Decimal(measurement.downKg).mul(1000);
    const allocatedGrams = new Prisma.Decimal(allocation.grams);
    if (!topGrams.isFinite() || !downGrams.isFinite() || !allocatedGrams.isFinite()
      || !topGrams.greaterThan(0) || !downGrams.greaterThan(0) || !allocatedGrams.greaterThan(0)) {
      return null;
    }
    const allocatedDownGrams = allocatedGrams.equals(topGrams)
      ? downGrams
      : downGrams.mul(allocatedGrams).div(topGrams);
    totalDownGrams = totalDownGrams.plus(allocatedDownGrams);
  }

  return totalDownGrams.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
}

function positiveDecimal(value: number | string, label: string) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
  const decimal = new Prisma.Decimal(text);
  if (!decimal.isFinite() || !decimal.greaterThan(0)) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
  return decimal;
}

export function calculateTradeAmount(quantityKg: number, purityBps: number, pricePerGram: number) {
  const kg = new Prisma.Decimal(String(quantityKg));
  const grossGrams = kg.mul(1000);
  const pureGrams = grossGrams.mul(purityBps).div(10000);
  const total = pureGrams.mul(String(pricePerGram)).toDecimalPlaces(2);
  return { kg, grossGrams, total };
}

export function calculateSaleQuote(
  quantityKg: string,
  purityBps: number,
  pricePerGram: string,
  discountAmount = "0",
) {
  const kg = positiveDecimal(quantityKg, "Sale weight");
  const price = positiveDecimal(pricePerGram, "Sale price");
  const discount = new Prisma.Decimal(discountAmount);
  if (!discount.isFinite() || discount.isNegative() || discount.decimalPlaces() > 2) {
    throw new RangeError("Discount must be a valid non-negative amount in pesewas");
  }
  if (!Number.isInteger(purityBps) || purityBps < 1 || purityBps > 10000) {
    throw new RangeError("Purity must be between 1 and 10000 basis points");
  }
  const grossGrams = kg.mul(1000);
  const pureGrams = grossGrams.mul(purityBps).div(10000);
  const subtotal = pureGrams.mul(price).toDecimalPlaces(2);
  if (discount.greaterThanOrEqualTo(subtotal)) {
    throw new RangeError("Discount must be less than the calculated sale value");
  }
  return {
    quantityKg: kg,
    grossGrams,
    pureGrams,
    subtotal,
    discount,
    total: subtotal.minus(discount),
  };
}

export function calculateBatchSaleQuote(
  allocations: { grams: Prisma.Decimal | string | number; purityBps: number }[],
  pricePerGram: Prisma.Decimal | string | number,
  discountAmount: Prisma.Decimal | string | number = "0",
) {
  const price = new Prisma.Decimal(pricePerGram);
  const discount = new Prisma.Decimal(discountAmount);
  if (!discount.isFinite() || discount.isNegative() || discount.decimalPlaces() > 2) {
    throw new RangeError("Discount must be a valid non-negative amount in pesewas");
  }
  let totalGrams = new Prisma.Decimal(0);
  let pureGrams = new Prisma.Decimal(0);
  for (const allocation of allocations) {
    const grams = new Prisma.Decimal(allocation.grams);
    if (!grams.isFinite() || !grams.greaterThan(0) || !Number.isInteger(allocation.purityBps)
      || allocation.purityBps < 1 || allocation.purityBps > 10000) {
      throw new RangeError("Batch weights and purity must be valid positive values");
    }
    totalGrams = totalGrams.plus(grams);
    pureGrams = pureGrams.plus(grams.mul(allocation.purityBps).div(10000));
  }
  if (!price.isFinite() || !price.greaterThan(0) || !totalGrams.greaterThan(0)) {
    throw new RangeError("Batch weights and gold price must be positive");
  }
  const subtotal = pureGrams.mul(price).toDecimalPlaces(2);
  if (discount.greaterThanOrEqualTo(subtotal)) {
    throw new RangeError("Discount must be less than the calculated sale value");
  }
  return {
    totalGrams,
    pureGrams,
    purityBps: pureGrams.mul(10000).div(totalGrams).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    subtotal,
    discount,
    total: subtotal.minus(discount),
  };
}

export function calculateWeightedBatchDensity(
  allocations: { grams: Prisma.Decimal | string | number; density: Prisma.Decimal | string | number | null }[],
) {
  if (!allocations.length) return null;
  let totalGrams = new Prisma.Decimal(0);
  let weightedDensity = new Prisma.Decimal(0);
  for (const allocation of allocations) {
    if (allocation.density === null) return null;
    const grams = new Prisma.Decimal(allocation.grams);
    const density = new Prisma.Decimal(allocation.density);
    if (!grams.isFinite() || !grams.greaterThan(0) || !density.isFinite() || !density.greaterThan(0)) return null;
    totalGrams = totalGrams.plus(grams);
    weightedDensity = weightedDensity.plus(grams.mul(density));
  }
  return totalGrams.greaterThan(0) ? weightedDensity.div(totalGrams) : null;
}

export function planFifo(
  lots: { id: string; remainingGrams: Prisma.Decimal; costPerGram: Prisma.Decimal }[],
  requestedGrams: Prisma.Decimal,
) {
  let remaining = requestedGrams.toDecimalPlaces(5);
  let costBasis = new Prisma.Decimal(0);
  const allocations: { lotId: string; grams: Prisma.Decimal; costAmount: Prisma.Decimal }[] = [];

  for (const lot of lots) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const grams = Prisma.Decimal.min(new Prisma.Decimal(lot.remainingGrams), remaining);
    const costAmount = grams.mul(lot.costPerGram).toDecimalPlaces(2);
    allocations.push({ lotId: lot.id, grams, costAmount });
    costBasis = costBasis.plus(costAmount);
    remaining = remaining.minus(grams);
  }

  return { allocations, remainingGrams: remaining, costBasis: costBasis.toDecimalPlaces(2) };
}
