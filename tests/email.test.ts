import assert from "node:assert/strict";
import test from "node:test";
import { ownerTransactionEmail, sendOwnerTransactionEmail } from "../src/lib/email";

test("owner transaction email notifications remain suspended unless explicitly enabled", async (t) => {
  const previous = process.env.OWNER_TRANSACTION_EMAILS_ENABLED;
  delete process.env.OWNER_TRANSACTION_EMAILS_ENABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.OWNER_TRANSACTION_EMAILS_ENABLED;
    else process.env.OWNER_TRANSACTION_EMAILS_ENABLED = previous;
  });

  assert.equal(await sendOwnerTransactionEmail({
    type: "PAYMENT",
    reference: "PAY-1002",
    direction: "INBOUND",
    amount: "100.00",
    method: "CASH",
    recordedBy: "Joe",
  }), false);
});

test("purchase owner emails include the purchase summary", () => {
  const message = ownerTransactionEmail({
    type: "PURCHASE",
    reference: "PUR-1001",
    counterpartyLabel: "Supplier",
    counterpartyName: "Ama Gold",
    quantityKg: "1.25",
    totalAmount: "1250.50",
    amountPaid: "500.00",
    recordedBy: "Joe",
  });
  assert.match(message.subject, /Purchase completed.*PUR-1001/);
  assert.match(message.text, /Ama Gold/);
  assert.match(message.text, /1,250\.50/);
  assert.match(message.html, /500\.00/);
});

test("transaction email content escapes user-provided HTML", () => {
  const message = ownerTransactionEmail({
    type: "SALE",
    reference: "SAL-1001",
    customerName: "<img src=x>",
    quantityKg: "0.5",
    totalAmount: "900.00",
    amountPaid: "400.00",
    recordedBy: "Ama",
  });
  assert.match(message.text, /<img src=x>/);
  assert.match(message.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(message.html, /<img src=x>/);
});

test("payment owner emails describe payment direction and transaction", () => {
  const message = ownerTransactionEmail({
    type: "PAYMENT",
    reference: "PAY-1001",
    direction: "INBOUND",
    amount: "400.00",
    method: "MOBILE_MONEY",
    customerName: "Kojo Buyer",
    tradeReference: "SAL-1001",
    recordedBy: "Ama",
  });
  assert.match(message.subject, /Payment recorded.*PAY-1001/);
  assert.match(message.text, /Money received/);
  assert.match(message.text, /SAL-1001/);
  assert.match(message.text, /mobile money/);
});

test("sale correction emails summarize returned gold, credit, and refund", () => {
  const message = ownerTransactionEmail({
    type: "SALE_CORRECTION",
    reference: "RET-1001",
    saleReference: "SAL-1001",
    correctionType: "RETURN",
    customerName: "Kojo Buyer",
    quantityKg: "0.25",
    creditAmount: "100.00",
    refundAmount: "50.00",
    recordedBy: "Ama",
  });
  assert.match(message.subject, /Sale return completed.*RET-1001/);
  assert.match(message.text, /SAL-1001/);
  assert.match(message.text, /Kojo Buyer/);
  assert.match(message.text, /50\.00/);
});
