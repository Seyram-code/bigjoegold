import { auth } from "@/lib/auth";
import { clearLoginFailures, getLoginLock, recordLoginFailure } from "@/lib/login-lockout";
import { loginAttemptSource } from "@/lib/login-lockout-policy";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/http";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();
const lockoutMessage = "Too many failed sign-in attempts. Try again in one minute. If you still cannot sign in, contact another owner to reset your password.";

export async function POST(request: Request) {
  try {
    const credentials = credentialsSchema.parse(await readJson(request));
    const email = credentials.email.toLowerCase();
    const account = await prisma.user.findFirst({
      where: { email, role: "OWNER" },
      select: { id: true },
    });
    const accountIdentifier = account ? `user:${account.id}` : `email:${email}`;
    const sourceIdentifier = `owner-source:${loginAttemptSource(request.headers)}`;
    const [accountRetryAfter, sourceRetryAfter] = await Promise.all([
      getLoginLock(accountIdentifier),
      getLoginLock(sourceIdentifier),
    ]);
    const retryAfter = Math.max(accountRetryAfter ?? 0, sourceRetryAfter ?? 0);
    if (retryAfter) {
      return Response.json(
        { message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds. If you still cannot sign in, contact another owner to reset your password.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const response = await auth.handler(new Request(new URL("/api/auth/sign-in/email", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify(credentials),
    }));

    if (response.ok) {
      await Promise.all([
        clearLoginFailures(accountIdentifier),
        clearLoginFailures(sourceIdentifier),
      ]);
      return response;
    }
    if (response.status !== 401 && response.status !== 403) return response;

    const attempts = await Promise.all([
      recordLoginFailure(accountIdentifier),
      recordLoginFailure(sourceIdentifier),
    ]);
    if (attempts.some((count) => count >= 3)) {
      return Response.json(
        { message: lockoutMessage },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const failedAttempts = Math.max(...attempts);
    return Response.json(
      { message: `Incorrect owner email or password. ${3 - failedAttempts} attempt${3 - failedAttempts === 1 ? "" : "s"} remain before a one-minute lockout.` },
      { status: 401 },
    );
  } catch (error) {
    return apiError(error);
  }
}
