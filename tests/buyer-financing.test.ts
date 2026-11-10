import assert from "node:assert/strict";
import test from "node:test";
import { calculateBuyerFinanceBalance } from "../src/lib/buyer-financing";
import { buyerFinanceSchema } from "../src/lib/validation";

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

test("buyer repayments reduce the outstanding financing balance", () => {
  const balance = calculateBuyerFinanceBalance(
    [
      { amount: "5000000.00", direction: "OUTBOUND" },
      { amount: "1000000.00", direction: "INBOUND" },
    ],
    [{ amount: "4000000.00" }],
  );
  assert.equal(balance.toFixed(2), "0.00");
});

test("buyer financing repayment validates amount, account, method, and date", () => {
  const repayment = {
    action: "REPAY",
    accountId: "buyer-finance-id",
    amount: "1000000.00",
    cashAccountId: "momo-account-id",
    method: "MOBILE_MONEY",
    paidAt: "2026-11-10T18:00:00.000Z",
  };
  assert.equal(buyerFinanceSchema.safeParse(repayment).success, true);
  assert.equal(buyerFinanceSchema.safeParse({ ...repayment, amount: "0" }).success, false);
  assert.equal(buyerFinanceSchema.safeParse({ ...repayment, method: "CRYPTO" }).success, false);
});
