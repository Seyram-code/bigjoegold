import assert from "node:assert/strict";
import test from "node:test";
import { buildExcelWorkbook } from "../src/lib/excel-export";
import { groupTradeTotals } from "../src/lib/reporting";

const transactions = [
  { transactionDate: "2026-10-26T08:00:00.000Z", type: "PURCHASE", quantityKg: 2, netAmount: 1000 },
  { transactionDate: "2026-10-27T08:00:00.000Z", type: "SALE", quantityKg: 0.5, netAmount: 400 },
  { transactionDate: "2026-11-02T08:00:00.000Z", type: "PURCHASE", quantityKg: 1, netAmount: 600 },
];

test("purchase and sale report totals group by day, Monday-based week, and month", () => {
  assert.deepEqual(groupTradeTotals(transactions, "day").map((row) => row.period), [
    "2026-10-26", "2026-10-27", "2026-11-02",
  ]);
  assert.deepEqual(groupTradeTotals(transactions, "week"), [
    { period: "Week of 2026-10-26", purchasesKg: 2, purchaseValue: 1000, salesKg: 0.5, salesValue: 400 },
    { period: "Week of 2026-11-02", purchasesKg: 1, purchaseValue: 600, salesKg: 0, salesValue: 0 },
  ]);
  assert.deepEqual(groupTradeTotals(transactions, "month"), [
    { period: "2026-10", purchasesKg: 2, purchaseValue: 1000, salesKg: 0.5, salesValue: 400 },
    { period: "2026-11", purchasesKg: 1, purchaseValue: 600, salesKg: 0, salesValue: 0 },
  ]);
});

test("Excel workbook export creates multiple escaped, typed worksheets", () => {
  const workbook = buildExcelWorkbook([
    { name: "Sales", rows: [["Customer", "Amount"], ['A & <B>', 12.5]] },
    { name: "Stock", rows: [["Batch", "Active"], ["BAT-1", true]] },
  ]);
  assert.match(workbook, /<Worksheet ss:Name="Sales">/);
  assert.match(workbook, /A &amp; &lt;B&gt;/);
  assert.match(workbook, /<Data ss:Type="Number">12\.5<\/Data>/);
  assert.match(workbook, /<Data ss:Type="Boolean">1<\/Data>/);
});
