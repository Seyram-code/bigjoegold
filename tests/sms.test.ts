import assert from "node:assert/strict";
import test from "node:test";
import { paymentConfirmationSms, purchaseConfirmationSms, saleConfirmationSms } from "../src/lib/sms";

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
