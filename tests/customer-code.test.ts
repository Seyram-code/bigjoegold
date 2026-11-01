import assert from "node:assert/strict";
import test from "node:test";
import { customerNameInitials, generateCustomerCode } from "../src/lib/customer-code";

test("customer codes use Big Joe Gold initials, customer initials, and five random digits", () => {
  assert.equal(customerNameInitials("Roselyn Agyeman"), "RA");
  assert.equal(customerNameInitials("  Kwame  Osei Mensah "), "KOM");
  assert.equal(customerNameInitials("Ési D’Costa"), "ÉD");
  assert.match(generateCustomerCode("Roselyn Agyeman"), /^BJG-RA-\d{5}$/);
  assert.match(generateCustomerCode("Single"), /^BJG-S-\d{5}$/);
});
