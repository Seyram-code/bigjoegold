import assert from "node:assert/strict";
import test from "node:test";
import {
  manualMomoContactImportFieldForHeader,
  normalizeManualMomoPhone,
} from "../src/lib/manual-momo-contacts";
import { manualMomoContactImportRowSchema, manualMomoContactSchema } from "../src/lib/validation";

test("manual Bank and MOMO contacts accept names with optional contact details", () => {
  assert.equal(manualMomoContactSchema.safeParse({ name: "Ama Mensah" }).success, true);
  assert.equal(manualMomoContactSchema.safeParse({
    name: "Ama Mensah",
    phone: "024 123 4567",
    email: "ama@example.com",
    notes: "Regular customer",
  }).success, true);
  assert.equal(manualMomoContactSchema.safeParse({ name: "A", email: "not-an-email" }).success, false);
});

test("manual Bank and MOMO contact imports map headers and validate required names", () => {
  assert.equal(manualMomoContactImportFieldForHeader("Contact Name"), "name");
  assert.equal(manualMomoContactImportFieldForHeader("Mobile Number"), "phone");
  assert.equal(manualMomoContactImportFieldForHeader("Email Address"), "email");
  assert.equal(manualMomoContactImportRowSchema.safeParse({ name: "Ama Mensah" }).success, true);
  assert.equal(manualMomoContactImportRowSchema.safeParse({ phone: "0241234567" }).success, false);
});

test("manual Bank and MOMO contact phone matching normalizes Ghana phone formats", () => {
  assert.equal(normalizeManualMomoPhone("024 123 4567"), "233241234567");
  assert.equal(normalizeManualMomoPhone("+233 24 123 4567"), "233241234567");
  assert.equal(normalizeManualMomoPhone("24-123-4567"), "233241234567");
  assert.equal(normalizeManualMomoPhone(""), null);
});
