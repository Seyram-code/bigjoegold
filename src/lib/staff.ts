import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "@prisma/client";
import type { Permission, StaffRole } from "@/lib/permissions";

export function generateStaffAccessCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const characters = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `BJG-${characters.match(/.{1,4}/g)?.join("-")}`;
}

export function generateStaffAuthEmail() {
  return `staff-${randomUUID()}@staff.bigjoegold.com`;
}

export function hashStaffAccessCode(accessCode: string) {
  const normalized = accessCode.trim().toUpperCase();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  return createHmac("sha256", secret).update(`staff-access-code:${normalized}`).digest("hex");
}

/** Temporary compatibility for codes issued before keyed hashes were introduced. */
export function legacyStaffAccessCodeHash(accessCode: string) {
  return createHash("sha256").update(accessCode.trim().toUpperCase()).digest("hex");
}

export function staffAccessCredentialPassword(accessCode: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  return createHmac("sha256", secret).update(accessCode.trim().toUpperCase()).digest("base64url");
}

export async function createCredentialUser(
  tx: Prisma.TransactionClient,
  input: { name: string; phone: string; role: StaffRole; permissions?: Permission[] },
) {
  const accessCode = generateStaffAccessCode();
  const email = generateStaffAuthEmail();
  const password = await hashPassword(staffAccessCredentialPassword(accessCode));
  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      name: input.name.trim(),
      email,
      phone: input.phone.trim(),
      accessCodeHash: hashStaffAccessCode(accessCode),
      role: input.role,
      permissionOverrideSet: input.permissions !== undefined,
      ...(input.permissions !== undefined
        ? { permissionGrants: { create: input.permissions.map((permissionCode) => ({ permissionCode })) } }
        : {}),
      emailVerified: true,
    },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password,
    },
  });
  return { ...user, accessCode };
}

export async function createOwnerCredentialUser(
  tx: Prisma.TransactionClient,
  input: { name: string; email: string; phone: string; password: string },
) {
  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      role: "OWNER",
      emailVerified: true,
    },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(input.password),
    },
  });
  return user;
}
