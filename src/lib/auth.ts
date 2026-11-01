import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getLoginLock } from "@/lib/login-lockout";
import { prisma } from "@/lib/prisma";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "mysql" }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: (request) => {
    if (process.env.NODE_ENV === "production") return [];
    const origin = request?.headers.get("origin");
    if (!origin) return [];
    try {
      const url = new URL(origin);
      return url.protocol === "http:" && localHosts.has(url.hostname) ? [url.origin] : [];
    } catch {
      return [];
    }
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/email") return;
      const email = context.body.email;
      if (typeof email !== "string") throw new APIError("FORBIDDEN", { message: "Use owner email and password or a staff access code." });
      const account = await prisma.user.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          ...( /^staff-[0-9a-f-]+@staff\.bigjoegold\.com$/i.test(email) ? {} : { role: "OWNER" }),
        },
        select: { id: true, role: true, isActive: true },
      });
      if (!account && !/^staff-[0-9a-f-]+@staff\.bigjoegold\.com$/i.test(email)) {
        const retryAfter = await getLoginLock(`email:${email}`);
        if (retryAfter) throw new APIError("TOO_MANY_REQUESTS", { message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds. If you still cannot sign in, contact an owner.` });
        throw new APIError("FORBIDDEN", { message: "Use owner email and password or a staff access code." });
      }
      if (account?.role === "OWNER" && !account.isActive) {
        throw new APIError("FORBIDDEN", { message: "Use owner email and password or a staff access code." });
      }
      if (account) {
        const retryAfter = await getLoginLock(`user:${account.id}`);
        if (retryAfter) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds. If you still cannot sign in, contact an owner.`,
          });
        }
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "TRADER", input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      phone: { type: "string", required: false, input: false },
    },
  },
});
