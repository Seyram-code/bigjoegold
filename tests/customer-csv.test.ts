import assert from "node:assert/strict";
import test from "node:test";
import { customerCsvCell, customerCsvRow } from "../src/lib/customer-csv";

test("customer CSV quotes fields and neutralizes spreadsheet formulas", () => {
  assert.equal(customerCsvCell('A "quoted" name'), '"A ""quoted"" name"');
  assert.equal(customerCsvCell("=HYPERLINK(\"https://example.invalid\")"), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(customerCsvCell("  @SUM(A1:A2)"), '"\'  @SUM(A1:A2)"');
  assert.equal(customerCsvRow(["Name", "Address, city"]), '"Name","Address, city"');
});
