import assert from "node:assert/strict";
import test from "node:test";
import { generateStaffAccessCode, generateStaffAuthEmail, hashStaffAccessCode, staffAccessCredentialPassword } from "../src/lib/staff";
import { ownerCreateSchema, staffSchema } from "../src/lib/validation";

test("staff access codes use the company prefix and 80 random bits", () => {
  const code = generateStaffAccessCode();
  assert.match(code, /^BJG-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.notEqual(generateStaffAuthEmail(), generateStaffAuthEmail());
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = "test-secret-with-at-least-32-characters";
  try {
    assert.equal(hashStaffAccessCode(code), hashStaffAccessCode(code.toLowerCase()));
    assert.match(hashStaffAccessCode(code), /^[a-f0-9]{64}$/);
    assert.equal(staffAccessCredentialPassword(code), staffAccessCredentialPassword(code.toLowerCase()));
    assert.ok(staffAccessCredentialPassword(code).length >= 12);
  } finally {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
  }
});

test("staff creation requires name and phone but defaults role", () => {
  assert.deepEqual(staffSchema.parse({ name: "Ama Mensah", phone: "+233201234567" }), {
    name: "Ama Mensah",
    phone: "+233201234567",
    role: "TRADER",
  });
  assert.throws(() => staffSchema.parse({ name: "Ama Mensah" }));
});

test("owner creation requires valid email, phone, and matching strong passwords", () => {
  const input = {
    name: "Ama Mensah",
    email: " ama@example.com ",
    phone: "+233201234567",
    password: "A-strong-owner-password",
    confirmPassword: "A-strong-owner-password",
  };
  assert.deepEqual(ownerCreateSchema.parse(input), {
    ...input,
    name: "Ama Mensah",
    email: "ama@example.com",
    phone: "+233201234567",
  });
  assert.throws(() => ownerCreateSchema.parse({ ...input, confirmPassword: "a-different-password" }));
  assert.throws(() => ownerCreateSchema.parse({ ...input, password: "short", confirmPassword: "short" }));
  assert.throws(() => ownerCreateSchema.parse({ ...input, email: "invalid" }));
});
