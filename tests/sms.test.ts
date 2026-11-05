import assert from "node:assert/strict";
import test from "node:test";
import { paymentConfirmationSms, purchaseConfirmationSms, saleConfirmationSms, sendOwnerSms } from "../src/lib/sms";

test("purchase SMS identifies the completed purchase and its financial value", () => {
  const message = purchaseConfirmationSms({
    reference: "PUR-1001", supplierName: "Ama Gold", quantityKg: "1.25", totalAmount: "1250.50", amountPaid: "500.00", recordedBy: "Joe",
  });
  assert.match(message, /PUR-1001/);
  assert.match(message, /Ama Gold/);
  assert.match(message, /1,250\.50/);
});

test("sale and payment SMS messages identify their transaction context", () => {
  const sale = saleConfirmationSms({
    reference: "SAL-1001", customerName: "Kojo Buyer", quantityKg: "0.5", totalAmount: "900.00", amountPaid: "400.00", recordedBy: "Ama",
  });
  const payment = paymentConfirmationSms({
    reference: "PAY-1001", direction: "INBOUND", amount: "400.00", method: "MOBILE_MONEY", tradeReference: "SAL-1001", recordedBy: "Ama",
  });
  assert.match(sale, /SAL-1001/);
  assert.match(sale, /Kojo Buyer/);
  assert.match(payment, /PAY-1001/);
  assert.match(payment, /mobile money/);
  assert.match(payment, /SAL-1001/);
});

test("Wigal rejection logs bounded, redacted provider details", async (t) => {
  const env = {
    WIGAL_FROG_API_KEY: "test-api-secret",
    WIGAL_FROG_USERNAME: "test-user",
    WIGAL_FROG_SENDER_ID: "BJGOLD",
    WIGAL_FROG_OWNER_PHONE: "+233200000000",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, env);

  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    code: "DENIED",
    message: `Rejected test-api-secret +233200000000 ${"x".repeat(300)}`,
  }), { status: 403 }));

  assert.equal(await sendOwnerSms("test message"), false);
  assert.equal(errors.length, 1);
  const details = errors[0][1] as { status: number; providerCode: string; providerMessage: string };
  assert.equal(details.status, 403);
  assert.equal(details.providerCode, "DENIED");
  assert.ok(details.providerMessage.length <= 240);
  assert.doesNotMatch(details.providerMessage, /test-api-secret|\+233200000000/);
});

test("Wigal SMS request follows the documented per-destination payload", async (t) => {
  const env = {
    WIGAL_FROG_API_KEY: "test-api-secret",
    WIGAL_FROG_USERNAME: "test-user",
    WIGAL_FROG_SENDER_ID: "BJGOLD",
    WIGAL_FROG_OWNER_PHONE: "+233200000000",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, env);

  let requestBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: "ACCEPTD" }), { status: 200 });
  });

  assert.equal(await sendOwnerSms("BJG test message"), true);
  assert.deepEqual(requestBody, {
    senderid: "BJGOLD",
    destinations: [{
      destination: "+233200000000",
      message: "BJG test message",
      msgid: (requestBody?.destinations as Array<{ msgid: string }>)[0].msgid,
      smstype: "text",
    }],
  });
  assert.equal(typeof (requestBody?.destinations as Array<{ msgid: unknown }>)[0].msgid, "string");
});

test("Wigal SMS sends to each configured phone number once", async (t) => {
  const env = {
    WIGAL_FROG_API_KEY: "test-api-secret",
    WIGAL_FROG_USERNAME: "test-user",
    WIGAL_FROG_SENDER_ID: "BJGOLD",
    WIGAL_FROG_OWNER_PHONE: " +233200000000, +233200000001, +233200000000 ",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, env);

  let requestBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: "ACCEPTD" }), { status: 200 });
  });

  assert.equal(await sendOwnerSms("BJG test message"), true);
  const destinations = requestBody?.destinations as Array<{ destination: string; message: string; msgid: string; smstype: string }>;
  assert.deepEqual(destinations.map(({ destination }) => destination), ["+233200000000", "+233200000001"]);
  assert.ok(destinations.every((entry) => entry.message === "BJG test message" && entry.smstype === "text"));
  assert.equal(new Set(destinations.map(({ msgid }) => msgid)).size, 2);
});
