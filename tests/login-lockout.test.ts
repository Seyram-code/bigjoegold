import test from "node:test";
import assert from "node:assert/strict";
import { loginAttemptSource, loginLockoutRemainingSeconds, nextLoginFailure } from "../src/lib/login-lockout-policy";

test("staff access-code lockout source is stable while submitted codes change", () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.8" });
  assert.equal(loginAttemptSource(headers), "203.0.113.8");
  assert.equal(loginAttemptSource(headers), "203.0.113.8");
});

test("login lockout source falls back to the proxy address when direct IP is unavailable", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.2" });
  assert.equal(loginAttemptSource(headers), "10.0.0.2");
});

test("the third failed sign-in starts a fresh one-minute lockout", () => {
  const now = new Date("2026-11-01T16:00:59.000Z");
  const next = nextLoginFailure({
    count: 2,
    windowStartedAt: new Date("2026-11-01T16:00:00.000Z"),
  }, now);

  assert.equal(next.count, 3);
  assert.equal(next.windowStartedAt.getTime(), now.getTime());
  assert.equal(loginLockoutRemainingSeconds(next, now.getTime()), 60);
});

test("failed attempts cannot clear an active lockout", () => {
  const bucket = {
    count: 3,
    windowStartedAt: new Date("2026-11-01T16:00:00.000Z"),
  };
  const now = new Date("2026-11-01T16:00:30.000Z");

  assert.deepEqual(nextLoginFailure(bucket, now), bucket);
  assert.equal(loginLockoutRemainingSeconds(bucket, now.getTime()), 30);
});

test("the next failed sign-in after the lock expires starts a new attempt window", () => {
  const next = nextLoginFailure({
    count: 3,
    windowStartedAt: new Date("2026-11-01T16:00:00.000Z"),
  }, new Date("2026-11-01T16:01:00.000Z"));

  assert.equal(next.count, 1);
  assert.equal(next.windowStartedAt.toISOString(), "2026-11-01T16:01:00.000Z");
});
