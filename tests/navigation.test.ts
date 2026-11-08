import assert from "node:assert/strict";
import test from "node:test";
import { getWorkspaceView, workspaceNavigation } from "../src/lib/workspace-navigation";

test("every workspace navigation destination resolves to a page view", () => {
  const visit = (items: typeof workspaceNavigation) => {
    for (const item of items) {
      if (item.href !== "/") assert.ok(getWorkspaceView(item.href), `Missing page view for ${item.href}`);
      if (item.children) visit(item.children);
    }
  };

  visit(workspaceNavigation);
  assert.equal(getWorkspaceView("/customers")?.customerKind, "BUYER");
  assert.equal(getWorkspaceView("/receiving-suppliers")?.customerKind, "SUPPLIER");
});

test("all requested sales and stock subpages are present", () => {
  const sales = workspaceNavigation.find((item) => item.label === "Sales");
  const stock = workspaceNavigation.find((item) => item.label === "Add Stock");
  assert.deepEqual(sales?.children?.map((item) => item.label), [
    "All Sales",
    "New Sale",
    "Sales History",
    "Sales Payments",
    "Returns and Reversals",
  ]);
  assert.deepEqual(stock?.children?.map((item) => item.label), [
    "Opening Stock",
    "Manual Stock Adjustment",
    "Stock Transfers",
  ]);
  const inventory = workspaceNavigation.find((item) => item.label === "Inventory");
  assert.ok(inventory?.children?.some((item) => item.label === "Reconciliation"));
});

test("finance navigation exposes account management, summaries, and reconciliation", () => {
  const financing = workspaceNavigation.find((item) => item.label === "Financing");
  assert.equal(financing?.href, "/finance/financing");
  assert.equal(financing?.permission, "payments");
  const finance = workspaceNavigation.find((item) => item.label === "Finance");
  assert.deepEqual(finance?.children?.map((item) => item.label), [
    "Payments Received",
    "Payments Made",
    "Expenses",
    "Cash and Bank Accounts",
    "Financial Summaries",
    "Transaction Reconciliation",
  ]);
  for (const path of [
    "/finance/payments-received",
    "/finance/payments-made",
    "/finance/financing",
    "/finance/customer-advances",
    "/finance/buyer-financing",
    "/finance/accounts",
    "/finance/summaries",
    "/finance/reconciliation",
  ]) assert.ok(getWorkspaceView(path), `Missing finance page for ${path}`);
});
