import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateCustomerAdvanceBalance } from "../src/lib/customer-advance-balance";

test("consolidated customer advances net payments and gold releases across all prior accounts", () => {
  const balance = calculateCustomerAdvanceBalance(
    new Prisma.Decimal(0),
    [
      { direction: "INBOUND", amount: new Prisma.Decimal("17732339.00") },
      { direction: "INBOUND", amount: new Prisma.Decimal("28128196.00") },
      { direction: "OUTBOUND", amount: new Prisma.Decimal("11128196.00") },
    ],
    [
      { amount: new Prisma.Decimal("25069823.26") },
      { amount: new Prisma.Decimal("3754690.77") },
    ],
  );

  assert.equal(balance.toFixed(2), "5907824.97");
});
