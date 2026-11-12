import { auth } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";
import { clearLoginFailures, getLoginLock, recordLoginFailure } from "@/lib/login-lockout";
import { loginAttemptSource } from "@/lib/login-lockout-policy";
import { hashStaffAccessCode, legacyStaffAccessCodeHash, staffAccessCredentialPassword } from "@/lib/staff";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const accessCodeSchema = z.object({
  accessCode: z.string().trim().toUpperCase().regex(/^(?:BJG\d{4}|BJG-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3})$/),
}).strict();
const invalidCodeEmail = "staff-00000000-0000-4000-8000-000000000000@staff.bigjoegold.com";
const lockoutMessage = "Too many failed sign-in attempts. Try again in one minute. If you still cannot sign in, contact the owner for a new access code.";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const rawAccessCode = typeof body === "object" && body !== null && "accessCode" in body && typeof body.accessCode === "string"
      ? body.accessCode.trim().toUpperCase()
      : "";
    const codeIsWellFormed = accessCodeSchema.safeParse({ accessCode: rawAccessCode }).success;
    const accessCode = codeIsWellFormed ? rawAccessCode : "";
    const sourceIdentifier = `staff-source:${loginAttemptSource(request.headers)}`;
    const retryAfter = await getLoginLock(sourceIdentifier);
    if (retryAfter) {
      return Response.json(
        { message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds. If you still cannot sign in, contact the owner for a new access code.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    if (!codeIsWellFormed) {
      const attempts = await recordLoginFailure(sourceIdentifier);
      if (attempts >= 3) {
        return Response.json(
          { message: lockoutMessage },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      return Response.json(
        { message: `Incorrect access code. ${3 - attempts} attempt${3 - attempts === 1 ? "" : "s"} remain before a one-minute lockout.` },
        { status: 401 },
      );
    }

    const user = await prisma.user.findFirst({
      where: { accessCodeHash: { in: [hashStaffAccessCode(accessCode), legacyStaffAccessCodeHash(accessCode)] } },
      select: { id: true, email: true, isActive: true, role: true },
    });
    const accountIdentifier = user ? `user:${user.id}` : null;
    const accountRetryAfter = accountIdentifier ? await getLoginLock(accountIdentifier) : null;
    if (accountRetryAfter) {
      return Response.json(
        { message: `Too many failed sign-in attempts. Try again in ${accountRetryAfter} seconds. If you still cannot sign in, contact the owner for a new access code.` },
        { status: 429, headers: { "Retry-After": String(accountRetryAfter) } },
      );
    }
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const response = await auth.handler(new Request(new URL("/api/auth/sign-in/email", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: user?.isActive && user.role !== "OWNER" ? user.email : invalidCodeEmail,
        password: staffAccessCredentialPassword(accessCode),
      }),
    }));
    if (response.ok) {
      await Promise.all([
        clearLoginFailures(sourceIdentifier),
        accountIdentifier ? clearLoginFailures(accountIdentifier) : Promise.resolve(),
      ]);
      return response;
    }
    if (response.status !== 401 && response.status !== 403) return response;
    const attempts = await Promise.all([
      recordLoginFailure(sourceIdentifier),
      accountIdentifier ? recordLoginFailure(accountIdentifier) : Promise.resolve(0),
    ]);
    if (attempts.some((count) => count >= 3)) {
      return Response.json(
        { message: lockoutMessage },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const failedAttempts = Math.max(...attempts);
    return Response.json(
      { message: `Incorrect access code. ${3 - failedAttempts} attempt${3 - failedAttempts === 1 ? "" : "s"} remain before a one-minute lockout.` },
      { status: 401 },
    );
  } catch (error) {
    return apiError(error);
  }
}
