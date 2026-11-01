export const MAX_FAILED_LOGIN_ATTEMPTS = 3;
export const LOGIN_LOCKOUT_MS = 60_000;

export type LoginAttemptBucket = { count: number; windowStartedAt: Date };

export function loginAttemptSource(headers: Headers) {
  const directAddress = headers.get("x-real-ip")?.trim();
  if (directAddress) return directAddress;

  const forwardedAddresses = headers.get("x-forwarded-for")?.split(",").map((address) => address.trim()).filter(Boolean);
  return forwardedAddresses?.at(-1) ?? "unknown";
}

export function loginLockoutRemainingSeconds(bucket: LoginAttemptBucket, now = Date.now()) {
  if (bucket.count < MAX_FAILED_LOGIN_ATTEMPTS) return 0;
  const remainingMs = LOGIN_LOCKOUT_MS - (now - bucket.windowStartedAt.getTime());
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function nextLoginFailure(bucket: LoginAttemptBucket, now: Date): LoginAttemptBucket {
  const remainingSeconds = loginLockoutRemainingSeconds(bucket, now.getTime());
  if (remainingSeconds > 0) return bucket;

  const expired = now.getTime() - bucket.windowStartedAt.getTime() >= LOGIN_LOCKOUT_MS;
  const count = expired || bucket.count >= MAX_FAILED_LOGIN_ATTEMPTS ? 1 : bucket.count + 1;
  return {
    count,
    windowStartedAt: count >= MAX_FAILED_LOGIN_ATTEMPTS || expired ? now : bucket.windowStartedAt,
  };
}
