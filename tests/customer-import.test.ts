import assert from "node:assert/strict";
import test from "node:test";
import { readJson } from "../src/lib/http";
import {
  customerImportFieldForHeader,
  customerImportRowSchema,
  formatImportedPhone,
  normalizeCustomerImportValue,
  normalizeImportedPhone,
} from "../src/lib/customer-import";

test("customer import headers accept common name and phone variants", () => {
  assert.equal(customerImportFieldForHeader("Customer Full Name"), "name");
  assert.equal(customerImportFieldForHeader("Full Name"), "name");
  assert.equal(customerImportFieldForHeader("Phone Number"), "phone");
  assert.equal(customerImportFieldForHeader("unknown"), undefined);
});

test("customer import normalizes optional type, gender, and ID values", () => {
  assert.equal(normalizeCustomerImportValue("type", "Business"), "BUSINESS");
  assert.equal(normalizeCustomerImportValue("gender", "Prefer not to say"), "PREFER_NOT_TO_SAY");
  assert.equal(normalizeCustomerImportValue("idType", "Ghana Card"), "GHANA_CARD");
  assert.equal(normalizeCustomerImportValue("idType", "Driver's License"), "DRIVERS_LICENSE");
});

test("customer import requires a name and a valid phone while defaulting customer type", () => {
  const valid = customerImportRowSchema.parse({ name: "Ama Mensah", phone: "0241234567" });
  assert.equal(valid.type, "INDIVIDUAL");
  assert.equal(customerImportRowSchema.safeParse({ name: "Ama Mensah", phone: "" }).success, false);
  assert.equal(customerImportRowSchema.safeParse({ name: "", phone: "0241234567" }).success, false);
});

test("customer import phone matching normalizes Ghana local and country-code formats", () => {
  assert.equal(normalizeImportedPhone("024 123 4567"), "241234567");
  assert.equal(normalizeImportedPhone("+233 24 123 4567"), "241234567");
  assert.equal(normalizeImportedPhone("+1 (415) 555-0100"), "14155550100");
  assert.equal(formatImportedPhone("024 123 4567"), "+233 241234567");
  assert.equal(formatImportedPhone("+1 (415) 555-0100"), "+1 (415) 555-0100");
});

test("customer import JSON accepts the larger configured request limit", async () => {
  const body = JSON.stringify({ value: "x".repeat(70 * 1024) });
  const request = () => new Request("http://127.0.0.1:3001/api/customers/import", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3001" },
    body,
  });
  const parsed = await readJson(request(), 128 * 1024);
  if (typeof parsed !== "object" || parsed === null || !("value" in parsed) || typeof parsed.value !== "string") {
    throw new Error("The larger request body did not parse as expected");
  }
  assert.equal(parsed.value.length, 70 * 1024);
  await assert.rejects(() => readJson(request()), /Request body is too large/);
});
