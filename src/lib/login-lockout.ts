import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loginLockoutRemainingSeconds, nextLoginFailure } from "@/lib/login-lockout-policy";

function bucketKey(identifier: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  const digest = createHmac("sha256", secret).update(identifier.trim().toLowerCase()).digest("hex");
  return `login:${digest}`;
}

export async function getLoginLock(identifier: string) {
  const key = bucketKey(identifier);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number; windowStartedAt: Date }>>(Prisma.sql`
    SELECT \`count\`, \`windowStartedAt\`
    FROM \`ApiRequestRateLimit\`
    WHERE \`key\` = ${key}
  `);
  if (!bucket) return null;
  const remainingSeconds = loginLockoutRemainingSeconds(bucket);
  return remainingSeconds > 0 ? remainingSeconds : null;
}

export async function recordLoginFailure(identifier: string) {
  const key = bucketKey(identifier);
  const now = new Date();
  const count = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT IGNORE INTO \`ApiRequestRateLimit\` (\`key\`, \`count\`, \`windowStartedAt\`)
      VALUES (${key}, 0, ${now})
    `);
    const [bucket] = await tx.$queryRaw<Array<{ count: number; windowStartedAt: Date }>>(Prisma.sql`
      SELECT \`count\`, \`windowStartedAt\`
      FROM \`ApiRequestRateLimit\`
      WHERE \`key\` = ${key}
      FOR UPDATE
    `);
    if (!bucket) throw new Error("Login attempt bucket was not persisted");
    const next = nextLoginFailure(bucket, now);
    await tx.$executeRaw(Prisma.sql`
      UPDATE \`ApiRequestRateLimit\`
      SET \`count\` = ${next.count}, \`windowStartedAt\` = ${next.windowStartedAt}
      WHERE \`key\` = ${key}
    `);
    return next.count;
  });
  return count;
}

export async function clearLoginFailures(identifier: string) {
  const key = bucketKey(identifier);
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM \`ApiRequestRateLimit\`
    WHERE \`key\` = ${key}
  `);
}
