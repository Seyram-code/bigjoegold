import assert from "node:assert/strict";
import test from "node:test";
import { calculatePurchaseMeasurements } from "../src/lib/gold";
import { movementBalance } from "../src/lib/inventory";
import { DEFAULT_PURCHASE_FORMULA_RULES } from "../src/lib/purchase-formula";
import { purchaseMeasurementCorrectionSchema } from "../src/lib/validation";

test("purchase measurement corrections require valid top/down weights and an audit reason", () => {
  const valid = purchaseMeasurementCorrectionSchema.safeParse({
    topGrams: "455.25",
    downGrams: "24",
    boardPriceId: "receiving-board-price",
    reason: "Corrected from the current scale reading",
  });
  assert.equal(valid.success, true);

  const invalidPrecision = purchaseMeasurementCorrectionSchema.safeParse({
    topGrams: "455.123456",
    downGrams: "24",
    boardPriceId: "receiving-board-price",
    reason: "Corrected from the current scale reading",
  });
  assert.equal(invalidPrecision.success, false);

  const missingReason = purchaseMeasurementCorrectionSchema.safeParse({
    topGrams: "455",
    downGrams: "24",
    boardPriceId: "receiving-board-price",
    reason: "",
  });
  assert.equal(missingReason.success, false);
});

test("corrected receiving measurements recalculate purchase value and derived purity", () => {
  const original = calculatePurchaseMeasurements("455", "24", "11166", DEFAULT_PURCHASE_FORMULA_RULES);
  const corrected = calculatePurchaseMeasurements("456", "24.5", "11166", DEFAULT_PURCHASE_FORMULA_RULES);

  assert.ok(corrected.amount.isPositive());
  assert.notEqual(corrected.amount.toFixed(2), original.amount.toFixed(2));
  assert.notEqual(corrected.karat.toFixed(2), original.karat.toFixed(2));
  assert.equal(corrected.topGrams.toString(), "456");
  assert.equal(corrected.downGrams.toString(), "24.5");
});

test("selecting a different receiving price recalculates the purchase amount", () => {
  const originalPrice = calculatePurchaseMeasurements("455", "24", "11166", DEFAULT_PURCHASE_FORMULA_RULES);
  const correctedPrice = calculatePurchaseMeasurements("455", "24", "12000", DEFAULT_PURCHASE_FORMULA_RULES);

  assert.equal(correctedPrice.pounds.toString(), originalPrice.pounds.toString());
  assert.equal(correctedPrice.density.toString(), originalPrice.density.toString());
  assert.notEqual(correctedPrice.amount.toFixed(2), originalPrice.amount.toFixed(2));
});

test("measurement correction movements preserve the stock ledger balance across repeated edits", () => {
  const balance = movementBalance([
    { type: "PURCHASE_RECEIPT", quantityGrams: "455" },
    { type: "MEASUREMENT_CORRECTION_IN", quantityGrams: "1" },
    { type: "MEASUREMENT_CORRECTION_OUT", quantityGrams: "2.5" },
  ]);
  assert.equal(balance.toString(), "453.5");
});
