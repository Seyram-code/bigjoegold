import assert from "node:assert/strict";
import test from "node:test";
import { calculateBuyerFinanceBalance } from "../src/lib/buyer-financing";

test("buyer financing balance reduces when gold is received", () => {
  const balance = calculateBuyerFinanceBalance(
    [{ amount: "1000000.00", direction: "OUTBOUND" }],
    [{ amount: "150000.00" }],
  );
  assert.equal(balance.toFixed(2), "850000.00");
});

test("buyer financing balance can be negative when received gold exceeds advances", () => {
  const balance = calculateBuyerFinanceBalance(
    [{ amount: "1000000.00", direction: "OUTBOUND" }],
    [{ amount: "1200000.00" }],
  );
  assert.equal(balance.toFixed(2), "-200000.00");
});
