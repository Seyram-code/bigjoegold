import assert from "node:assert/strict";
import test from "node:test";
import { effectivePermissions, hasPermission } from "../src/lib/permissions";
import { redactAuditDetails } from "../src/lib/records";

test("role templates separate purchase, sales, inventory, finance, and auditor access", () => {
  assert.equal(hasPermission("GOLD_RECEIVER", "purchases:write"), true);
  assert.equal(hasPermission("GOLD_RECEIVER", "sales:write"), false);
  assert.equal(hasPermission("SALES_OFFICER", "sales:write"), true);
  assert.equal(hasPermission("SALES_OFFICER", "transactions:reverse"), false);
  assert.equal(hasPermission("SALES_OFFICER", "board:write"), false);
  assert.equal(hasPermission("MANAGER", "board:write"), true);
  assert.equal(hasPermission("INVENTORY_OFFICER", "inventory:adjust"), true);
  assert.equal(hasPermission("INVENTORY_OFFICER", "board:write"), false);
  assert.equal(hasPermission("AUDITOR", "reports:read"), true);
  assert.equal(hasPermission("AUDITOR", "payments:write"), false);
});

test("explicit permission assignments replace defaults and owners retain full access", () => {
  assert.deepEqual(effectivePermissions("SALES_OFFICER", ["sales:write"]), ["sales:write"]);
  assert.equal(hasPermission("OWNER", "settings:manage", []), true);
  assert.equal(hasPermission("SALES_OFFICER", "sales:write", []), false);
});

test("audit details redact password and secret-like fields recursively", () => {
  assert.deepEqual(redactAuditDetails({
    before: { role: "VIEWER" },
    after: { role: "MANAGER", passwordHash: "do-not-store", nested: [{ accessToken: "hidden" }] },
  }), {
    before: { role: "VIEWER" },
    after: { role: "MANAGER", passwordHash: "[REDACTED]", nested: [{ accessToken: "[REDACTED]" }] },
  });
});
