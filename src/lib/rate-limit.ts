import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";

export async function enforceUserRateLimit(
  userId: string,
  route: string,
  { limit = 30, windowSeconds = 60 }: { limit?: number; windowSeconds?: number } = {},
) {
  const key = `${route}:${userId}`;
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO \`ApiRequestRateLimit\` (\`key\`, \`count\`, \`windowStartedAt\`)
    VALUES (${key}, 1, ${now})
    ON DUPLICATE KEY UPDATE
      \`count\` = IF(
        \`windowStartedAt\` <= DATE_SUB(VALUES(\`windowStartedAt\`), INTERVAL ${windowSeconds} SECOND),
        1,
        \`count\` + 1
      ),
      \`windowStartedAt\` = IF(
        \`windowStartedAt\` <= DATE_SUB(VALUES(\`windowStartedAt\`), INTERVAL ${windowSeconds} SECOND),
        VALUES(\`windowStartedAt\`),
        \`windowStartedAt\`
      )
  `);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number; windowStartedAt: Date }>>(Prisma.sql`
    SELECT \`count\`, \`windowStartedAt\`
    FROM \`ApiRequestRateLimit\`
    WHERE \`key\` = ${key}
  `);
  if (!bucket) throw new Error("Rate-limit bucket was not persisted");
  if (bucket.count > limit) {
    const elapsedSeconds = Math.floor((now.getTime() - bucket.windowStartedAt.getTime()) / 1000);
    throw new HttpError("Too many requests. Please wait before trying again.", 429, Math.max(1, windowSeconds - elapsedSeconds));
  }
}
