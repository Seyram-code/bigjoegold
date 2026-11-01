import assert from "node:assert/strict";
import test from "node:test";
import { detectReceiptMediaType, safeDocumentFilename } from "../src/lib/document-validation";

test("detects only supported receipt signatures", () => {
  assert.equal(detectReceiptMediaType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(detectReceiptMediaType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectReceiptMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectReceiptMediaType(Buffer.from("<html>")), null);
  assert.equal(detectReceiptMediaType(Buffer.from([0xff, 0xd8])), null);
});

test("sanitizes receipt filenames and provides a safe fallback", () => {
  assert.equal(safeDocumentFilename("../../receipt.pdf", "application/pdf"), "receipt.pdf");
  assert.equal(safeDocumentFilename("folder\\receipt?.png", "image/png"), "receipt_.png");
  assert.equal(safeDocumentFilename("..", "image/jpeg"), "receipt.jpg");
});
