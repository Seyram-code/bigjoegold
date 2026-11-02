import assert from "node:assert/strict";
import test from "node:test";
import { decryptStaffAccessCode, encryptStaffAccessCode, generateStaffAccessCode, generateStaffAuthEmail, hashStaffAccessCode, staffAccessCredentialPassword } from "../src/lib/staff";
import { ownerCreateSchema, staffSchema } from "../src/lib/validation";

test("staff access codes use the company prefix and four random digits", () => {
  const code = generateStaffAccessCode();
  assert.match(code, /^BJG\d{4}$/);
  assert.notEqual(generateStaffAuthEmail(), generateStaffAuthEmail());
  assert.equal(hashStaffAccessCode(code), hashStaffAccessCode(code.toLowerCase()));
  assert.match(hashStaffAccessCode(code), /^[a-f0-9]{64}$/);
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = "test-secret-with-at-least-32-characters";
  try {
    assert.equal(staffAccessCredentialPassword(code), staffAccessCredentialPassword(code.toLowerCase()));
    assert.ok(staffAccessCredentialPassword(code).length >= 12);
  } finally {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
  }
});

test("staff access codes can be stored encrypted and decrypted with the configured key", () => {
  const originalKey = process.env.STAFF_ACCESS_CODE_ENCRYPTION_KEY;
  process.env.STAFF_ACCESS_CODE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const code = generateStaffAccessCode();
    const encrypted = encryptStaffAccessCode(code);
    assert.notEqual(encrypted, code);
    assert.equal(decryptStaffAccessCode(encrypted), code);
    const [iv, tag, data] = encrypted.split(".");
    const tampered = `${iv}.${tag}.${data?.replace(/^./, (character) => character === "A" ? "B" : "A")}`;
    assert.throws(() => decryptStaffAccessCode(tampered));
  } finally {
    if (originalKey === undefined) delete process.env.STAFF_ACCESS_CODE_ENCRYPTION_KEY;
    else process.env.STAFF_ACCESS_CODE_ENCRYPTION_KEY = originalKey;
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
