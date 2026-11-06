import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { calculateBatchSaleQuote, calculateMeasuredSaleQuote, calculatePurchaseMeasurements, calculateSaleQuote, calculateTradeAmount, calculateWeightedBatchDensity, inferSaleDownWeightFromReceipts, planFifo } from "../src/lib/gold";
import { DEFAULT_PURCHASE_FORMULA_RULES, PURCHASE_FORMULA_VERSION, purchaseFormulaRules } from "../src/lib/purchase-formula";
import { HttpError, readJson } from "../src/lib/http";
import { receivingSchema, saleCorrectionSchema, saleSchema, tradeSchema } from "../src/lib/validation";
import { customerSchema, customerUpdateSchema } from "../src/lib/validation";
import { formatCurrency, formatCurrencyExact, formatCurrencyWholeGhsTruncated, formatPriceAmount, formatTwoDecimalTruncated, formatWeight } from "../src/lib/formatters";
import { formatCompactNumberTruncated, formatDecimalTruncated } from "../src/lib/decimal-policy";
import { compareBoardPriceHistory } from "../src/lib/board-prices";
import { boardPriceSchema } from "../src/lib/validation";
import { inventoryMovementSchema } from "../src/lib/validation";
import { ledgerBalances, movementBalance } from "../src/lib/inventory";
import { createBatchCode } from "../src/lib/records";
import { calculateCashBalances } from "../src/lib/finance";
import { calculateAvailableInventoryMeasurementTotals, calculateInventoryAverageKarat, calculateReceivedMeasurementTotals, calculateSoldDownWeight } from "../src/lib/dashboard-metrics";
import { buildManualMomoAccountSummaries, buildManualMomoStatement } from "../src/lib/manual-momo";
import { buildDailyBuyerFinancingSummary, buildDailyMansoBranchSummary, buildDailySupplierPurchaseSummary, calculateProfitMetrics } from "../src/lib/reporting";
import { calculateMansoBranchPurchase } from "../src/lib/manso-branch";
import { customerAdvanceSchema, financeAccountSchema, financeMovementSchema, financeSettingsSchema, manualMomoAccountCreateSchema, manualMomoAccountSchema, manualMomoEntrySchema, mansoBranchActionSchema, purchaseFormulaSettingsSchema } from "../src/lib/validation";

test("generated batch codes are eight uppercase alphanumeric characters", () => {
  const code = createBatchCode();
  assert.match(code, /^[A-Z0-9]{8}$/);
});

test("trade value uses pure grams and truncates to pesewas", () => {
  const { grossGrams, total } = calculateTradeAmount(1, 9999, 5000);
  assert.equal(grossGrams.toString(), "1000");
  assert.equal(total.toFixed(2), "4999500.00");
  assert.equal(calculateTradeAmount(0.001, 10000, 1.239).total.toString(), "1.23");
});

test("profit reports use the allocated receiving cost for full and partial sales", () => {
  const purchase = calculatePurchaseMeasurements("455", "24", "11166");
  const fullSale = calculateMeasuredSaleQuote("455", "24", "12333");
  const fullProfit = calculateProfitMetrics(fullSale.total.toFixed(2), purchase.amount.toFixed(2));
  assert.equal(purchase.amount.toFixed(2), "665703.32");
  assert.equal(fullSale.total.toFixed(2), "735278.44");
  assert.equal(fullProfit.profit, 69575.12);
  assert.ok(Math.abs((fullProfit.grossMargin ?? 0) - 0.094624) < 0.000001);
  assert.ok(Math.abs((fullProfit.returnOnCost ?? 0) - 0.104514) < 0.000001);

  const partialSale = calculateMeasuredSaleQuote("200", "10.54945", "12333");
  const allocatedReceivingCost = purchase.amount.div("455").toDecimalPlaces(6).mul("200").toDecimalPlaces(2);
  const partialProfit = calculateProfitMetrics(partialSale.total.toFixed(2), allocatedReceivingCost.toFixed(2));
  assert.equal(allocatedReceivingCost.toFixed(2), "292616.84");
  assert.equal(partialSale.total.toFixed(2), "323171.78");
  assert.equal(partialProfit.profit, 30554.94);
  assert.ok(Math.abs((partialProfit.returnOnCost ?? 0) - 0.104420) < 0.000001);
});

test("Manso branch gold uses measured purity and entered cost without board pricing", () => {
  const purchase = calculateMansoBranchPurchase("455", "24", "600000", DEFAULT_PURCHASE_FORMULA_RULES);
  assert.equal(purchase.measurements.karat.toFixed(2), "23.36");
  assert.equal(purchase.actualCost.toFixed(2), "600000.00");
  assert.equal(purchase.costPerGram.toFixed(6), "1318.681318");
  assert.ok(purchase.pricePerGram.greaterThan(0));
});

test("Manso branch gold receipt requires an actual cost and measured weights", () => {
  const valid = mansoBranchActionSchema.safeParse({
    action: "RECEIVE_GOLD",
    topGrams: "455",
    downGrams: "24",
    actualCost: "600000",
    transactionDate: new Date().toISOString(),
  });
  assert.equal(valid.success, true);
  const missingCost = mansoBranchActionSchema.safeParse({
    action: "RECEIVE_GOLD",
    topGrams: "455",
    downGrams: "24",
    transactionDate: new Date().toISOString(),
  });
  assert.equal(missingCost.success, false);
});

test("advance gold fulfillment uses the current price for the released grams", () => {
  const fulfillmentValue = calculateTradeAmount(4, 10000, 11259).total;
  assert.equal(fulfillmentValue.toFixed(2), "45036000.00");
  assert.equal(new Prisma.Decimal(2000000).minus(fulfillmentValue).toFixed(2), "-43036000.00");
});

test("advance gold valuation derives a weighted purity and value from selected stock batches", () => {
  const quote = calculateBatchSaleQuote([
    { grams: "1000", purityBps: 9167 },
    { grams: "3000", purityBps: 7500 },
  ], "11259");
  assert.equal(quote.purityBps, 7917);
  assert.equal(quote.total.toFixed(2), "35653875.30");
});

test("sale valuation uses allocated batch purity and subtracts discounts from the exact weighted value", () => {
  const quote = calculateBatchSaleQuote([
    { grams: "1000", purityBps: 9167 },
    { grams: "3000", purityBps: 7500 },
  ], "11259", "25.75");
  assert.equal(quote.purityBps, 7917);
  assert.equal(quote.pureGrams.toFixed(4), "3166.7000");
  assert.equal(quote.subtotal.toFixed(2), "35653875.30");
  assert.equal(quote.discount.toFixed(2), "25.75");
  assert.equal(quote.total.toFixed(2), "35653849.55");
});

test("sale density is weighted by allocated grams and unavailable if any batch lacks density", () => {
  const density = calculateWeightedBatchDensity([
    { grams: "1000", density: "19" },
    { grams: "3000", density: "15" },
  ]);
  assert.equal(density?.toFixed(4), "16.0000");
  assert.equal(calculateWeightedBatchDensity([
    { grams: "1000", density: "19" },
    { grams: "3000", density: null },
  ]), null);
});

test("purchase amount applies the karat discount multiplier and truncates measurements", () => {
  const result = calculatePurchaseMeasurements("7.75", "0.5", "100");
  assert.equal(result.pounds.toFixed(2), "1.00");
  assert.equal(result.density.toFixed(2), "15.50");
  assert.equal(result.karat.toFixed(2), "16.89");
  assert.equal(result.amount.toFixed(2), "73.43");
});

test("assay measurements display two decimal places by truncating", () => {
  assert.equal(formatTwoDecimalTruncated("58.8271"), "58.82");
  assert.equal(formatTwoDecimalTruncated("17.9988"), "17.99");
  assert.equal(formatTwoDecimalTruncated("21.9844"), "21.98");
  assert.equal(formatTwoDecimalTruncated("58"), "58.00");
  assert.equal(formatTwoDecimalTruncated("455.0000"), "455.00");
  assert.equal(formatTwoDecimalTruncated("25.0000"), "25.00");
});

test("receiving calculations use administrator-supplied formula rules", () => {
  const result = calculatePurchaseMeasurements("7.75", "0.5", "100", {
    ...DEFAULT_PURCHASE_FORMULA_RULES,
    poundsKgDivisor: "5",
  });
  assert.equal(result.pounds.toFixed(2), "1.55");
  assert.equal(result.amount.toFixed(2), "113.82");
});

test("receiving formula matches the external calculator sample", () => {
  const result = calculatePurchaseMeasurements("100", "5.4", "1000", DEFAULT_PURCHASE_FORMULA_RULES);
  assert.equal(result.pounds.toFixed(2), "12.90");
  assert.equal(result.density.toFixed(2), "18.51");
  assert.equal(result.karat.toFixed(2), "22.67");
  assert.equal(formatTwoDecimalTruncated(result.purity.toString()), "94.46");
  assert.equal(result.amount.toFixed(2), "12714.91");
});

test("receiving karat and amount match the NWDGC staged-discount sample", () => {
  const result = calculatePurchaseMeasurements("458.90", "24.2", "11230", DEFAULT_PURCHASE_FORMULA_RULES);
  assert.equal(result.pounds.toFixed(2), "59.21");
  assert.equal(result.density.toFixed(2), "18.96");
  assert.equal(result.karat.toFixed(2), "23.37");
  assert.equal(result.purity.toFixed(2), "97.38");
  assert.equal(result.amount.toFixed(2), "675624.97");
  assert.equal(formatCurrencyWholeGhsTruncated(result.amount.toString()), "GHS 675,624.00");
});

test("measured sales use the receiving assay formula and selling price", () => {
  const quote = calculateMeasuredSaleQuote("458.90", "24.2", "11230", "25.75");
  assert.equal(quote.pounds.toFixed(2), "59.21");
  assert.equal(quote.density.toFixed(2), "18.96");
  assert.equal(quote.karat.toFixed(2), "23.37");
  assert.equal(quote.purityBps, 9738);
  assert.equal(quote.subtotal.toFixed(2), "675624.97");
  assert.equal(quote.total.toFixed(2), "675599.22");
  assert.throws(() => calculateMeasuredSaleQuote("458.90", "24.2", "11230", "675624.97"), /Discount must be less/);
});

test("sale down weight sums each fully allocated batch's receiving down weight", () => {
  const downGrams = inferSaleDownWeightFromReceipts([
    { lotId: "BASA89YL", grams: "443.74" },
    { lotId: "0GC3CJZY", grams: "761.85" },
  ], [
    { id: "BASA89YL", purchaseMeasurement: { topKg: "0.44374", downKg: "0.417" } },
    { id: "0GC3CJZY", purchaseMeasurement: { topKg: "0.76185", downKg: "0.723" } },
  ]);
  assert.equal(downGrams?.toString(), "1140");
});

test("sale down weight scales proportionally for partially allocated batches", () => {
  const downGrams = inferSaleDownWeightFromReceipts([
    { lotId: "BASA89YL", grams: "221.87" },
    { lotId: "0GC3CJZY", grams: "380.925" },
  ], [
    { id: "BASA89YL", purchaseMeasurement: { topKg: "0.44374", downKg: "0.417" } },
    { id: "0GC3CJZY", purchaseMeasurement: { topKg: "0.76185", downKg: "0.723" } },
  ]);
  assert.equal(downGrams?.toString(), "570");
});

test("sale down weight stays unset when a selected batch has no receiving measurement", () => {
  assert.equal(inferSaleDownWeightFromReceipts([
    { lotId: "BASA89YL", grams: "443.74" },
  ], [{ id: "BASA89YL", purchaseMeasurement: null }]), null);
});

test("previously confirmed formula versions require confirmation of the new calculation", () => {
  const savedRules = purchaseFormulaRules({
    version: "BJG-RECEIVING-2.0.0",
    ownerConfirmed: true,
    poundsKgDivisor: { toString: () => "7.75" },
    densityReference: { toString: () => "10.51" },
    karatMultiplier: { toString: () => "52.838" },
    karatDiscountMultiplier: { toString: () => "0.993" },
    amountKaratDivisor: { toString: () => "23" },
  });
  assert.equal(PURCHASE_FORMULA_VERSION, "BJG-RECEIVING-3.0.0");
  assert.equal(savedRules.version, "BJG-RECEIVING-2.0.0");
  assert.equal(savedRules.ownerConfirmed, false);
});

test("purchase amount uses displayed two-decimal pounds and karat", () => {
  const result = calculatePurchaseMeasurements("455.91", "25.33", "11079", {
    ...DEFAULT_PURCHASE_FORMULA_RULES,
    karatDiscountMultiplier: "1",
  });
  assert.equal(result.amount.toFixed(2), "622200.10");
});

test("receiving assay matches screenshot-style rounded measurements and whole-GHS display", () => {
  const result = calculatePurchaseMeasurements("1518.65", "83.55", "11079", {
    ...DEFAULT_PURCHASE_FORMULA_RULES,
    karatDiscountMultiplier: "1",
  });
  assert.equal(result.pounds.toFixed(2), "195.95");
  assert.equal(result.density.toFixed(2), "18.17");
  assert.equal(result.karat.toFixed(2), "22.27");
  assert.equal(result.purity.toFixed(2), "92.79");
  assert.equal(result.amount.toFixed(2), "2102026.61");
  assert.equal(formatCurrencyWholeGhsTruncated(result.amount.toString()), "GHS 2,102,026.00");
});

test("purchase formula settings validate positive divisors and explicit confirmation", () => {
  const valid = {
    ownerConfirmed: false,
    poundsKgDivisor: "7.75",
    densityReference: "10.51",
    karatMultiplier: "52.838",
    karatDiscountMultiplier: "0.993",
    amountKaratDivisor: "23",
  };
  assert.equal(purchaseFormulaSettingsSchema.safeParse(valid).success, true);
  assert.equal(purchaseFormulaSettingsSchema.safeParse({ ...valid, poundsKgDivisor: "0" }).success, false);
  assert.equal(purchaseFormulaSettingsSchema.safeParse({ ...valid, karatDiscountMultiplier: "1.01" }).success, false);
  assert.equal(purchaseFormulaSettingsSchema.safeParse({ ...valid, ownerConfirmed: "true" }).success, false);
});

test("readJson accepts same-origin requests and rejects cross-origin mutations", async (t) => {
  const previousAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
  t.after(() => {
    if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousAuthUrl;
  });

  const sameOrigin = new Request("http://127.0.0.1:3001/api/settings/purchase-formula", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3001",
    },
    body: JSON.stringify({ ok: true }),
  });
  await assert.doesNotReject(() => readJson(sameOrigin));

  const localhostEquivalent = new Request("http://localhost:3001/api/settings/purchase-formula", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3001",
    },
    body: JSON.stringify({ ok: true }),
  });
  await assert.doesNotReject(() => readJson(localhostEquivalent));

  const sameOriginNoOriginHeader = new Request("http://127.0.0.1:3001/api/settings/purchase-formula", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ ok: true }),
  });
  await assert.doesNotReject(() => readJson(sameOriginNoOriginHeader));

  const crossOrigin = new Request("http://127.0.0.1:3001/api/settings/purchase-formula", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify({ ok: true }),
  });
  await assert.rejects(() => readJson(crossOrigin), /Cross-origin or originless mutations are not allowed/);
});

test("receiving calculations reject zero, negative, non-finite, and non-positive results", () => {
  assert.throws(() => calculatePurchaseMeasurements("1", "0", "100"), /Down weight must be/);
  assert.throws(() => calculatePurchaseMeasurements("-1", "1", "100"), /Top weight must be/);
  assert.throws(() => calculatePurchaseMeasurements("Infinity", "1", "100"), /Top weight must be/);
  assert.throws(() => calculatePurchaseMeasurements("1", "0.1", "100"), /non-positive karat or purchase amount/);
});

test("receiving calculations reject karat above 24 rather than capping the result", () => {
  assert.throws(
    () => calculatePurchaseMeasurements("100", "4", "1000"),
    /Calculated karat exceeds 24/,
  );
});

test("receiving validation rejects zero down-weight and manual calculation overrides", () => {
  const valid = {
    action: "DRAFT",
    customerId: "customer-id",
    transactionDate: "2026-10-26T06:00:00.000Z",
    topGrams: "1250",
    downGrams: "500",
    boardPriceId: "board-price-id",
    amountPaid: "0",
    paymentMethod: "CASH",
  };
  assert.equal(receivingSchema.safeParse(valid).success, true);
  const receivingWithoutPaymentDetails = receivingSchema.parse({
    ...valid,
    amountPaid: undefined,
    paymentMethod: undefined,
  });
  assert.equal(receivingWithoutPaymentDetails.amountPaid, "0");
  assert.equal(receivingWithoutPaymentDetails.paymentMethod, "CASH");
  assert.equal(receivingSchema.safeParse({ ...valid, downGrams: "0" }).success, false);
  assert.equal(receivingSchema.safeParse({ ...valid, pounds: "12" }).success, false);
  const financed = {
    ...valid,
    action: "COMPLETE",
    financingAccountId: "buyer-finance-id",
    amountPaid: "0",
    cashAccountId: "",
  };
  assert.equal(receivingSchema.safeParse(financed).success, true);
  assert.equal(receivingSchema.safeParse({ ...financed, amountPaid: "1.00" }).success, false);
  assert.equal(receivingSchema.safeParse({ ...valid, financingAccountId: "buyer-finance-id" }).success, false);
});

test("customer gold advance actions validate payment, request, and stock fulfillment inputs", () => {
  const commonPayment = {
    amount: "2000000.00",
    cashAccountId: "cash-account-id",
    method: "BANK_TRANSFER",
    paidAt: "2026-10-26T18:00:00.000Z",
  };
  assert.equal(customerAdvanceSchema.safeParse({
    action: "CREATE_ADVANCE",
    customerId: "customer-id",
    ...commonPayment,
  }).success, true);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "CREATE_ADVANCE",
    customerId: "customer-id",
    ...commonPayment,
    requestedGrams: "4000",
  }).success, true);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "CREATE_ADVANCE",
    customerId: "customer-id",
    ...commonPayment,
    requestedGrams: "0",
  }).success, false);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "REFUND",
    advanceId: "advance-id",
    ...commonPayment,
    note: "Customer requested refund",
  }).success, true);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "CREATE_REQUEST",
    advanceId: "advance-id",
    requestedGrams: "4000",
  }).success, true);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "FULFILL",
    requestId: "request-id",
    transactionDate: "2026-10-26T18:00:00.000Z",
    purityBps: 9999,
    pricePerGram: "12250",
    topGrams: "4000",
    downGrams: "220",
    allocations: [{ lotId: "lot-id", grams: "4000" }],
  }).success, true);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "FULFILL",
    requestId: "request-id",
    transactionDate: "2026-10-26T18:00:00.000Z",
    purityBps: 9999,
    pricePerGram: "12250",
    allocations: [{ lotId: "lot-id", grams: "4000" }],
  }).success, false);
  assert.equal(customerAdvanceSchema.safeParse({
    action: "CREATE_REQUEST",
    advanceId: "advance-id",
    requestedGrams: "0",
  }).success, false);
});

test("customer validation supports alternate phone and archive-only updates", () => {
  const customer = customerSchema.safeParse({
    name: "Example Customer",
    kind: "BUYER",
    type: "INDIVIDUAL",
    phone: "+233 200 000 000",
    alternativePhone: "+233 240 000 000",
    email: "",
    tin: "",
    address: "",
    notes: "",
  });

  test("customer validation accepts the additional profile form fields", () => {
    const customer = customerSchema.parse({
      name: "Ama Example",
      kind: "SUPPLIER",
      type: "INDIVIDUAL",
      phone: "+233 200 000 000",
      email: "",
      dateOfBirth: "1990-04-12",
      gender: "FEMALE",
      idType: "GHANA_CARD",
      idNumber: "GHA-123456789-0",
      addressLine1: "12 Example Street",
      addressLine2: "Apartment 2",
      city: "Accra",
      region: "Greater Accra",
      country: "Ghana",
      gpsLocation: "GA-123-4567",
      notes: "Registered in person",
    });
    assert.equal(customer.dateOfBirth, "1990-04-12");
    assert.equal(customer.idType, "GHANA_CARD");
    assert.equal(customer.country, "Ghana");
  });
  assert.equal(customer.success, true);
  assert.deepEqual(customerUpdateSchema.parse({ isActive: false }), { isActive: false });
  assert.equal(customerUpdateSchema.safeParse({}).success, false);
});

test("currency formatting preserves cents for values beyond JavaScript safe integer precision", () => {
  assert.match(formatCurrencyExact("100000000000000.23"), /100,000,000,000,000\.23/);
  assert.equal(formatPriceAmount("999999999999.123456", "GHS"), "GHS 999,999,999,999.123456");
});

test("numeric values truncate toward zero at display and decimal precision limits", () => {
  assert.equal(formatCurrency("1.239"), "GH₵ 1.23");
  assert.equal(formatCurrency("-1.239"), "-GH₵ 1.23");
  assert.equal(formatDecimalTruncated("-1.239", 2), "-1.23");
  assert.equal(formatWeight("0.1"), "100 g");
  assert.equal(formatWeight("0.99999"), "999.99 g");
  assert.equal(formatWeight("1"), "1.00 kg");
  assert.equal(formatWeight("17.99999"), "17.99 kg");
  assert.equal(formatWeight("34.229", "kg", 5), "34.22 kg");
  assert.equal(formatWeight("1349095.099", "g", 2), "1,349,095.09 g");
  assert.equal(formatWeight("455.9", "g", 2), "455.9 g");
  assert.equal(formatCompactNumberTruncated(1999), "1.9K");
  assert.equal(new Prisma.Decimal("1.239").toDecimalPlaces(2).toString(), "1.23");
});

test("FIFO planning consumes older lots first and calculates cost basis", () => {
  const plan = planFifo([
    { id: "older", remainingGrams: new Prisma.Decimal(400), costPerGram: new Prisma.Decimal(10) },
    { id: "newer", remainingGrams: new Prisma.Decimal(600), costPerGram: new Prisma.Decimal(12) },
  ], new Prisma.Decimal(750));

  assert.deepEqual(plan.allocations.map((item) => item.lotId), ["older", "newer"]);
  assert.deepEqual(plan.allocations.map((item) => item.grams.toNumber()), [400, 350]);
  assert.equal(plan.costBasis.toFixed(2), "8200.00");
  assert.equal(plan.remainingGrams.toNumber(), 0);
});

test("FIFO planning reports the exact uncovered weight without over-allocating", () => {
  const plan = planFifo([
    { id: "only-lot", remainingGrams: new Prisma.Decimal(500), costPerGram: new Prisma.Decimal(18) },
  ], new Prisma.Decimal(750));

  assert.equal(plan.allocations[0].grams.toNumber(), 500);
  assert.equal(plan.remainingGrams.toNumber(), 250);
});

test("sale quote calculates pure-weight value with pesewa-safe discount handling", () => {
  const quote = calculateSaleQuote("0.75", 9000, "120.50", "25.75");
  assert.equal(quote.grossGrams.toString(), "750");
  assert.equal(quote.pureGrams.toString(), "675");
  assert.equal(quote.subtotal.toFixed(2), "81337.50");
  assert.equal(quote.total.toFixed(2), "81311.75");

  assert.throws(() => calculateSaleQuote("0", 9000, "120.50"), /Sale weight must be/);
  assert.throws(() => calculateSaleQuote("0.75", 10001, "120.50"), /Purity must be/);
  assert.throws(() => calculateSaleQuote("0.75", 9000, "120.50", "-1"), /Discount must be/);
  assert.throws(() => calculateSaleQuote("0.75", 9000, "120.50", "81337.50"), /Discount must be less/);
});

test("sales validation requires explicit batch allocations and audited correction reasons", () => {
  const validSale = {
    customerId: "buyer-id",
    transactionDate: "2026-10-26T06:00:00.000Z",
    quantityKg: "0.75",
    purityBps: 9000,
    pricePerGram: "120.50",
    discountAmount: "25.75",
    initialPayment: "100.00",
    cashAccountId: "cash-account",
    method: "BANK_TRANSFER",
    topGrams: "750",
    downGrams: "40",
    allocations: [{ lotId: "lot-id", grams: "750" }],
  };
  assert.equal(saleSchema.safeParse(validSale).success, true);
  const saleWithoutPaymentDetails = saleSchema.parse({
    ...validSale,
    initialPayment: undefined,
    cashAccountId: undefined,
    method: undefined,
  });
  assert.equal(saleWithoutPaymentDetails.initialPayment, "0");
  assert.equal(saleWithoutPaymentDetails.method, "CASH");
  const saleWithoutMeasurements = { ...validSale, topGrams: undefined, downGrams: undefined };
  assert.equal(saleSchema.safeParse(saleWithoutMeasurements).success, false);
  assert.equal(saleSchema.safeParse({ ...validSale, discountAmount: "-1" }).success, false);
  assert.equal(saleSchema.safeParse({ ...validSale, allocations: [] }).success, false);
  assert.equal(saleCorrectionSchema.safeParse({
    type: "RETURN",
    reason: "Customer returned item",
    allocations: [{ lotId: "lot-id", grams: "750" }],
  }).success, true);
  assert.equal(saleCorrectionSchema.safeParse({ type: "REVERSAL", reason: "Wrong sale record" }).success, true);
  assert.equal(saleCorrectionSchema.safeParse({ type: "REVERSAL", reason: "bad" }).success, false);
});

test("inventory ledger applies immutable movement signs per batch and location-split transfer", () => {
  const movements = [
    { inventoryLotId: "source", type: "OPENING_BALANCE" as const, quantityGrams: "100" },
    { inventoryLotId: "source", type: "SALE_ISSUE" as const, quantityGrams: "30" },
    { inventoryLotId: "source", type: "SALE_RETURN" as const, quantityGrams: "5" },
    { inventoryLotId: "source", type: "ADJUSTMENT_IN" as const, quantityGrams: "2" },
    { inventoryLotId: "source", type: "TRANSFER_OUT" as const, quantityGrams: "20" },
    { inventoryLotId: "destination", type: "TRANSFER_IN" as const, quantityGrams: "20" },
  ];
  const balances = ledgerBalances(movements);
  assert.equal(balances.get("source")?.toString(), "57");
  assert.equal(balances.get("destination")?.toString(), "20");
  assert.equal(movementBalance(movements.filter((movement) => movement.inventoryLotId === "source")).toString(), "57");
});

test("inventory mutation validation requires reasons, positive weights, and valid opening measurements", () => {
  const validOpening = {
    action: "OPENING",
    source: "Opening inventory count",
    receivedAt: "2026-10-26T06:00:00.000Z",
    quantityKg: "1.25000000",
    pounds: "9.68750000",
    density: "15.50000000",
    purityBps: 9999,
    costPerGram: "120.500000",
    storageLocation: "Main storage",
    reason: "Opening balance approved",
  };
  assert.equal(inventoryMovementSchema.safeParse(validOpening).success, true);
  assert.equal(inventoryMovementSchema.safeParse({ ...validOpening, quantityKg: "0" }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...validOpening, reason: "bad" }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({
    action: "TRANSFER",
    lotId: "lot-id",
    quantityGrams: "0",
    destinationLocation: "Vault",
    reason: "Approved movement",
  }).success, false);
});

test("finance cash balances derive from approved immutable movements", () => {
  const balances = calculateCashBalances([
    { accountId: "cash", direction: "INBOUND", amount: new Prisma.Decimal("500.25"), approvalStatus: "NOT_REQUIRED" },
    { accountId: "cash", direction: "OUTBOUND", amount: new Prisma.Decimal("75.10"), approvalStatus: "APPROVED" },
    { accountId: "cash", direction: "OUTBOUND", amount: new Prisma.Decimal("20"), approvalStatus: "PENDING" },
    { accountId: "bank", direction: "INBOUND", amount: new Prisma.Decimal("100"), approvalStatus: "REJECTED" },
  ]);
  assert.equal(balances.get("cash")?.toFixed(2), "425.15");
  assert.equal(balances.has("bank"), false);
});

test("finance validation covers account metadata, movements, and optional approval thresholds", () => {
  const account = {
    name: "Main cash",
    type: "CASH",
    currency: "GHS",
    institution: "",
    accountReference: "",
    openingBalance: "250.00",
    openingDate: "2026-10-26T06:00:00.000Z",
  };
  assert.equal(financeAccountSchema.safeParse(account).success, true);
  assert.equal(financeAccountSchema.safeParse({ ...account, currency: "GHS1" }).success, false);
  assert.equal(financeMovementSchema.safeParse({
    action: "TRANSFER",
    fromAccountId: "cash",
    toAccountId: "bank",
    amount: "10.00",
    movementDate: "2026-10-26T06:00:00.000Z",
    description: "Move funds to bank",
  }).success, true);
  assert.equal(financeMovementSchema.safeParse({
    action: "TRANSFER",
    fromAccountId: "cash",
    toAccountId: "cash",
    amount: "0",
    movementDate: "2026-10-26T06:00:00.000Z",
    description: "Invalid transfer",
  }).success, false);
  assert.deepEqual(financeSettingsSchema.parse({ adjustmentApprovalThreshold: "1000.00" }), {
    adjustmentApprovalThreshold: "1000.00",
  });

  test("manual MOMO validation keeps wallet payments and opening balances constrained", () => {
    const entry = {
      accountId: "manual-momo-account-1",
      direction: "INBOUND",
      customerName: "Ama Customer",
      customerPhone: "0240000000",
      amount: "250.75",
      transactionReference: "MOMO-REF-1",
      transactionDate: "2026-10-30T12:00:00.000Z",
      note: "Customer payment",
    };
    assert.equal(manualMomoEntrySchema.safeParse(entry).success, true);
    assert.equal(manualMomoEntrySchema.safeParse({ ...entry, accountId: "" }).success, false);
    assert.equal(manualMomoEntrySchema.safeParse({ ...entry, amount: "-1" }).success, false);
    assert.equal(manualMomoEntrySchema.safeParse({ ...entry, amount: "10.001" }).success, false);

    const opening = {
      accountId: "manual-momo-account-2",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    };
    assert.equal(manualMomoAccountSchema.safeParse(opening).success, true);
    assert.equal(manualMomoAccountSchema.safeParse({ ...opening, openingBalance: "-0.01" }).success, false);
    assert.equal(manualMomoAccountCreateSchema.safeParse({
      type: "MOBILE_MONEY",
      name: "Customer Mobile Wallet",
      bankNameTelco: "MTN",
      accountNumber: "0240000000",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    }).success, true);
    assert.equal(manualMomoAccountCreateSchema.safeParse({
      type: "BANK",
      name: "X",
      bankNameTelco: "GCB",
      accountNumber: "123456789",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    }).success, false);
    assert.equal(manualMomoAccountCreateSchema.safeParse({
      type: "CASH",
      name: "Current Account",
      bankNameTelco: "GCB",
      accountNumber: "123456789",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    }).success, false);
    assert.equal(manualMomoAccountCreateSchema.safeParse({
      type: "BANK",
      name: "Current Account",
      bankNameTelco: "",
      accountNumber: "",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    }).success, false);
    assert.equal(manualMomoAccountCreateSchema.safeParse({
      type: "BANK",
      name: "Current Account",
      bankNameTelco: " ",
      accountNumber: "123456789",
      openingBalance: "1000.00",
      openingDate: "2026-10-01T00:00:00.000Z",
    }).success, false);
  });

  test("manual MOMO statements calculate opening, period, and running balances independently", () => {
    const firstPeriod = buildManualMomoStatement({
      openingBalance: 500,
      openingDate: "2026-10-01T00:00:00.000Z",
      balanceBeforePeriod: 0,
    }, [
      {
        reference: "MM-2",
        direction: "OUTBOUND",
        amount: 20.25,
        customerName: "Ama Customer",
        customerPhone: null,
        transactionReference: null,
        transactionDate: "2026-10-01T13:00:00.000Z",
        note: null,
      },
      {
        reference: "MM-1",
        direction: "INBOUND",
        amount: 100.1,
        customerName: "Kojo Customer",
        customerPhone: "0240000000",
        transactionReference: "MOMO-REF",
        transactionDate: "2026-10-01T12:00:00.000Z",
        note: "Received",
      },
    ], "2026-10-01", "2026-10-01");

    assert.equal(firstPeriod.opening, 500);
    assert.equal(firstPeriod.received, 100.1);
    assert.equal(firstPeriod.paid, 20.25);
    assert.equal(firstPeriod.closing, 579.85);
    assert.deepEqual(firstPeriod.rows.map((row) => row.balance), [500, 600.1, 579.85]);
    assert.equal(firstPeriod.rows[1].reference, "MOMO-REF");

    const nextPeriod = buildManualMomoStatement({
      openingBalance: 500,
      openingDate: "2026-10-01T00:00:00.000Z",
      balanceBeforePeriod: 579.85,
    }, [{
      reference: "MM-3",
      direction: "INBOUND",
      amount: 10,
      customerName: "Ama Customer",
      customerPhone: null,
      transactionReference: null,
      transactionDate: "2026-10-02T12:00:00.000Z",
      note: null,
    }], "2026-10-02", "2026-10-02");

    assert.equal(nextPeriod.opening, 579.85);
    assert.equal(nextPeriod.closing, 589.85);
    assert.equal(nextPeriod.rows.length, 1);
  });

  test("manual Bank and MOMO close summaries calculate each ledger independently", () => {
    const accounts = [
      { id: "momo", name: "MTN Wallet", type: "MOBILE_MONEY" as const, bankNameTelco: "MTN", accountNumber: "0240000000", openingBalance: 250, openingDate: "2026-10-01T00:00:00.000Z", balanceBeforePeriod: 300 },
      { id: "bank", name: "Main Bank", type: "BANK" as const, bankNameTelco: "Bank", accountNumber: "123456", openingBalance: 1000, openingDate: "2026-10-01T00:00:00.000Z", balanceBeforePeriod: 1200 },
    ];
    const summaries = buildManualMomoAccountSummaries(accounts, [
      {
        accountId: "momo",
        reference: "MM-1",
        direction: "INBOUND",
        amount: 80.25,
        customerName: "Ama",
        customerPhone: null,
        transactionReference: null,
        transactionDate: "2026-11-05T10:00:00.000Z",
        note: null,
      },
      {
        accountId: "momo",
        reference: "MM-2",
        direction: "OUTBOUND",
        amount: 20,
        customerName: "Kojo",
        customerPhone: null,
        transactionReference: null,
        transactionDate: "2026-11-05T12:00:00.000Z",
        note: null,
      },
      {
        accountId: "bank",
        reference: "MM-3",
        direction: "INBOUND",
        amount: 50,
        customerName: "Ama",
        customerPhone: null,
        transactionReference: null,
        transactionDate: "2026-11-05T10:00:00.000Z",
        note: null,
      },
    ], "2026-11-05", "2026-11-05");

    assert.deepEqual(summaries.map(({ opening, received, paid, closing }) => ({ opening, received, paid, closing })), [
      { opening: 300, received: 80.25, paid: 20, closing: 360.25 },
      { opening: 1200, received: 50, paid: 0, closing: 1250 },
    ]);
    assert.deepEqual(summaries.map(({ account, rows }) => ({
      name: account.name,
      transactionReferences: rows.map(({ reference }) => reference),
    })), [
      { name: "MTN Wallet", transactionReferences: ["OPENING BALANCE", "MM-1", "MM-2"] },
      { name: "Main Bank", transactionReferences: ["OPENING BALANCE", "MM-3"] },
    ]);
  });
});

test("daily customer gold financing summaries include prior balance and daily stock applied", () => {
  const rows = buildDailyBuyerFinancingSummary([{
    customerId: "buyer-1",
    customer: "Ama",
    payments: [
      { amount: 100, direction: "OUTBOUND", paidAt: "2026-10-31T12:00:00.000Z" },
      { amount: 50, direction: "OUTBOUND", paidAt: "2026-11-01T10:00:00.000Z" },
      { amount: 5, direction: "INBOUND", paidAt: "2026-11-01T11:00:00.000Z" },
    ],
    settlements: [
      { amount: 20, createdAt: "2026-10-31T13:00:00.000Z", quantityKg: 0.01 },
      { amount: 25, createdAt: "2026-11-01T12:00:00.000Z", quantityKg: 0.02 },
      { amount: 30, createdAt: "2026-11-02T12:00:00.000Z", quantityKg: 0.03 },
    ],
  }], "2026-11-01", "2026-11-02");

  assert.deepEqual(rows, [
    { date: "2026-11-01", customer: "Ama", stockKg: 0.02, financing: 50, balance: 100 },
    { date: "2026-11-02", customer: "Ama", stockKg: 0.03, financing: 0, balance: 70 },
  ]);
});

test("daily supplier purchase summaries show receipts, sales value, and running payables", () => {
  const rows = buildDailySupplierPurchaseSummary([
    {
      transactionDate: "2026-10-30T12:00:00.000Z",
      quantityKg: 0.1,
      totalAmount: 100,
      payments: [{ amount: 20, direction: "OUTBOUND", paidAt: "2026-10-31T12:00:00.000Z" }],
      settlements: [],
    },
    {
      transactionDate: "2026-11-02T09:00:00.000Z",
      quantityKg: 0.2,
      totalAmount: 200,
      payments: [{ amount: 100, direction: "OUTBOUND", paidAt: "2026-11-02T10:00:00.000Z" }],
      settlements: [{ amount: 20, createdAt: "2026-11-02T11:00:00.000Z" }],
    },
  ], "2026-11-01", "2026-11-02");

  assert.deepEqual(rows, [
    { date: "2026-11-02", stockKg: 0.2, sales: 200, balance: 160 },
  ]);
});

test("daily Manso summary reconciles advances, gold, expenses, returns, and running balance", () => {
  const rows = buildDailyMansoBranchSummary([
    { movementDate: "2026-10-31T12:00:00.000Z", type: "TRANSFER_IN", direction: "INBOUND", amount: 1000, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: false },
    { movementDate: "2026-11-02T09:00:00.000Z", type: "TRANSFER_IN", direction: "INBOUND", amount: 500.25, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: false },
    { movementDate: "2026-11-02T10:00:00.000Z", type: "PAYMENT", direction: "OUTBOUND", amount: 300, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: true },
    { movementDate: "2026-11-02T11:00:00.000Z", type: "ADJUSTMENT_OUT", direction: "OUTBOUND", amount: 50, approvalStatus: "APPROVED", isGoldPurchasePayment: false },
    { movementDate: "2026-11-02T12:00:00.000Z", type: "ADJUSTMENT_OUT", direction: "OUTBOUND", amount: 25, approvalStatus: "PENDING", isGoldPurchasePayment: false },
    { movementDate: "2026-11-02T13:00:00.000Z", type: "TRANSFER_OUT", direction: "OUTBOUND", amount: 100, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: false },
    { movementDate: "2026-11-03T09:00:00.000Z", type: "TRANSFER_IN", direction: "INBOUND", amount: 200, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: false },
    { movementDate: "2026-11-03T10:00:00.000Z", type: "PAYMENT", direction: "OUTBOUND", amount: 50, approvalStatus: "NOT_REQUIRED", isGoldPurchasePayment: true },
  ], "2026-11-02", "2026-11-03");

  assert.deepEqual(rows, [
    { date: "2026-11-02", amountGiven: 500.25, goldValue: 300, expenses: 50, cashReturned: 100, balanceLeft: 1050.25 },
    { date: "2026-11-03", amountGiven: 200, goldValue: 50, expenses: 0, cashReturned: 0, balanceLeft: 1200.25 },
  ]);
});

test("dashboard received measurements and current inventory karat are weighted by grams", () => {
  const received = calculateReceivedMeasurementTotals([
    {
      quantityKg: "1",
      purityBps: 9000,
      measurement: { pounds: "10", density: "10", karat: "18", downKg: "0.8" },
    },
    {
      quantityKg: "3",
      purityBps: 7500,
      measurement: { pounds: "30", density: "12", karat: "20", downKg: "2.4" },
    },
    {
      quantityKg: "1",
      purityBps: 8000,
      measurement: null,
    },
  ]);
  assert.equal(received.pounds, 40);
  assert.equal(received.downGrams, 3200);
  assert.equal(received.density, 11.5);
  assert.equal(received.karat, 19.44);

  assert.equal(calculateSoldDownWeight([
    { quantityKg: "1", measurement: { topGrams: "1000", downGrams: "800" }, returnedGrams: "250" },
    { quantityKg: "0.5", measurement: { topGrams: "500", downGrams: "450" }, returnedGrams: "0" },
    { quantityKg: "0.25", measurement: null, returnedGrams: "0" },
  ]), 1050);

  assert.equal(calculateInventoryAverageKarat([
    { grams: "1000", purityBps: 9000 },
    { grams: "3000", purityBps: 7500 },
  ]), 18.9);
  assert.equal(calculateInventoryAverageKarat([]), null);
});

test("available inventory measurements scale batch weights and weight density and karat by remaining grams", () => {
  assert.deepEqual(calculateAvailableInventoryMeasurementTotals([
    {
      grams: "500",
      originalGrams: "1000",
      purityBps: 9000,
      pounds: null,
      density: null,
      measurement: { topKg: "1", downKg: "0.8", pounds: "10", density: "10", karat: "18" },
    },
    {
      grams: "1500",
      originalGrams: "3000",
      purityBps: 7500,
      pounds: null,
      density: null,
      measurement: { topKg: "3", downKg: "2.4", pounds: "30", density: "12", karat: "20" },
    },
    {
      grams: "250",
      originalGrams: "500",
      purityBps: 8000,
      pounds: "2",
      density: "8",
      measurement: null,
    },
  ]), {
    topGrams: 2250,
    downGrams: 1600,
    pounds: 21,
    density: 11.11111111111111,
    karat: 19.466666666666665,
  });
  assert.deepEqual(calculateAvailableInventoryMeasurementTotals([]), {
    topGrams: 0,
    downGrams: 0,
    pounds: 0,
    density: null,
    karat: null,
  });
});

test("trade validation accepts pesewa precision and rejects smaller gold weights", () => {
  const valid = tradeSchema.safeParse({
    type: "PURCHASE",
    quantityKg: "0.000001",
    purityBps: "9999",
    pricePerGram: "99.90",
    initialPayment: "0.10",
    cashAccountId: "cash-account",
    method: "CASH",
  });
  assert.equal(valid.success, true);

  const invalid = tradeSchema.safeParse({
    type: "PURCHASE",
    quantityKg: "0.0000001",
    purityBps: "9999",
    pricePerGram: "99.90",
    method: "CASH",
  });
  assert.equal(invalid.success, false);
});

test("board price validation requires currency, unit, and an explicit current-price confirmation", () => {
  const price = {
    priceType: "RECEIVING",
    priceAmount: "1250.123456",
    currency: "GHS",
    priceUnit: "GHS_PER_GRAM_PURE_GOLD",
    source: "Approved desk rate",
    note: "",
    effectiveAt: "2026-10-26T06:00:00.000Z",
    expectedCurrentPriceId: null,
  };
  assert.equal(boardPriceSchema.safeParse(price).success, true);
  assert.equal(boardPriceSchema.safeParse({ ...price, expectedCurrentPriceId: undefined }).success, false);
  assert.equal(boardPriceSchema.safeParse({ ...price, priceAmount: "1.1234567" }).success, false);
  assert.equal(boardPriceSchema.safeParse({ ...price, currency: "US" }).success, false);
  assert.equal(boardPriceSchema.safeParse({ ...price, priceUnit: "" }).success, false);
});

test("board price history compares changes only within matching direction, currency, and unit", () => {
  const changes = compareBoardPriceHistory([
    { priceType: "RECEIVING", priceAmount: "120.000000", currency: "GHS", priceUnit: "GRAM" },
    { priceType: "RECEIVING", priceAmount: "100.000000", currency: "GHS", priceUnit: "GRAM" },
    { priceType: "SELLING", priceAmount: "130.000000", currency: "GHS", priceUnit: "GRAM" },
    { priceType: "RECEIVING", priceAmount: "90.000000", currency: "USD", priceUnit: "GRAM" },
    { priceType: "RECEIVING", priceAmount: "80.000000", currency: "GHS", priceUnit: "KILOGRAM" },
  ]);
  assert.equal(changes[0].delta, "20.000000");
  assert.equal(changes[0].percent, "20.00");
  assert.equal(changes[1].prior, null);
  assert.equal(changes[2].prior, null);
  assert.equal(changes[3].prior, null);
  assert.equal(changes[4].prior, null);
});

test("write request JSON requires same-origin and enforces body limits", async () => {
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const baseOrigin = new URL(baseUrl).origin;
  const parsed = await readJson(new Request(`${baseUrl}/api/customers`, {
    method: "POST",
    headers: { origin: baseOrigin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Test" }),
  }));
  assert.deepEqual(parsed, { name: "Test" });

  await assert.rejects(
    readJson(new Request(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    })),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  await assert.rejects(
    readJson(new Request(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: { origin: baseOrigin, "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(66_000) }),
    })),
    (error: unknown) => error instanceof HttpError && error.status === 413,
  );
});

test("credential hashes use Better Auth's supported password format", async () => {
  const password = "BigJoe-Local-Password-2026!";
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword({ hash, password }), true);
  assert.equal(await verifyPassword({ hash, password: "incorrect-password" }), false);
});
