import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { after } from "next/server";
import { addAudit } from "@/lib/records";
import { clearLoginFailures, getLoginLock } from "@/lib/login-lockout";
import { prisma } from "@/lib/prisma";
import { sendOwnerPasswordResetEmail } from "@/lib/email";
import { sendOwnerLoginSms } from "@/lib/sms";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "mysql" }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-real-ip", "x-forwarded-for"],
    },
  },
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
      "/request-password-reset": { window: 60, max: 3 },
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
    after: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/email") return;

      const returned = context.context.returned;
      if (returned instanceof APIError) return;
      if (returned instanceof Response && !returned.ok) return;

      let payload: unknown = returned;
      if (returned instanceof Response) {
        try {
          payload = await returned.clone().json();
        } catch (error) {
          console.error("Successful sign-in response could not be read for its owner SMS.", error);
          return;
        }
      }
      if (typeof payload !== "object" || payload === null || !("user" in payload)) return;
      const signedInUser = payload.user;
      if (typeof signedInUser !== "object" || signedInUser === null || !("id" in signedInUser) || typeof signedInUser.id !== "string") {
        console.error("Successful sign-in response did not include a valid user ID for its owner SMS.");
        return;
      }

      const signedInUserId = signedInUser.id;
      const loggedInAt = new Date();
      after(async () => {
        await sendOwnerLoginSms(signedInUserId, loggedInAt);
      });
    }),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const account = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, name: true, role: true, isActive: true },
      });
      if (!account || account.role !== "OWNER" || !account.isActive) return;
      await sendOwnerPasswordResetEmail({ email: account.email, name: account.name, url });
    },
    onPasswordReset: async ({ user }) => {
      let account: { role: string } | null;
      try {
        account = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
      } catch (error) {
        console.error("Password reset succeeded, but its owner audit and lockout cleanup could not be completed.", error);
        return;
      }
      if (account?.role !== "OWNER") return;
      try {
        await prisma.$transaction((tx) => addAudit(tx, {
          userId: user.id,
          action: "owner.password.reset.self_service",
          entity: "User",
          entityId: user.id,
          details: { before: null, after: { passwordReset: true, method: "email" } },
        }));
      } catch (error) {
        console.error("Owner password reset succeeded, but its audit entry could not be saved.", error);
      }
      try {
        await clearLoginFailures(`user:${user.id}`);
      } catch (error) {
        console.error("Owner password reset succeeded, but login failure counters could not be cleared.", error);
      }
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "TRADER", input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      phone: { type: "string", required: false, input: false },
    },
  },
});
