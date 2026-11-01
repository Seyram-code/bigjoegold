import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "@prisma/client";
import type { Permission, StaffRole } from "@/lib/permissions";

export function generateStaffAccessCode() {
  return `BJG${randomInt(0, 10_000).toString().padStart(4, "0")}`;
}

export function generateStaffAuthEmail() {
  return `staff-${randomUUID()}@staff.bigjoegold.com`;
}

export function hashStaffAccessCode(accessCode: string) {
  const normalized = accessCode.trim().toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function staffAccessCodeEncryptionKey() {
  const configuredKey = process.env.STAFF_ACCESS_CODE_ENCRYPTION_KEY;
  if (!configuredKey) throw new Error("STAFF_ACCESS_CODE_ENCRYPTION_KEY must be configured with a base64-encoded 32-byte key.");
  const key = Buffer.from(configuredKey, "base64");
  if (key.length !== 32) throw new Error("STAFF_ACCESS_CODE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptStaffAccessCode(accessCode: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", staffAccessCodeEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accessCode.trim().toUpperCase(), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptStaffAccessCode(encryptedAccessCode: string) {
  const [encodedIv, encodedTag, encodedData, ...extra] = encryptedAccessCode.split(".");
  if (!encodedIv || !encodedTag || !encodedData || extra.length) throw new Error("Stored staff access code has an invalid encrypted format.");
  const decipher = createDecipheriv("aes-256-gcm", staffAccessCodeEncryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, "base64url")),
    decipher.final(),
  ]).toString("utf8");
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
      accessCodeEncrypted: encryptStaffAccessCode(accessCode),
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
