import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";

export function reference(prefix: string) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createBatchCode() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export async function generateBatchNumber(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const batchNumber = createBatchCode();
    const existing = await tx.inventoryLot.findFirst({ where: { batchNumber }, select: { id: true } });
    if (!existing) return batchNumber;
  }
  throw new HttpError("Unable to generate a unique batch number. Please try again.", 503);
}

export function redactAuditDetails(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item) => item === null ? null : redactAuditDetails(item));
  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = /password|secret|token|credential|hash|authorization/i.test(key)
        ? "[REDACTED]"
        : item === null ? null : redactAuditDetails(item);
    }
    return output;
  }
  throw new TypeError("Audit details must be JSON serializable");
}

export async function addAudit(
  tx: Prisma.TransactionClient,
  input: { userId: string; action: string; entity: string; entityId?: string; details?: Prisma.InputJsonValue },
) {
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      details: input.details === undefined ? undefined : redactAuditDetails(input.details),
    },
  });
}

export function serializeDecimal<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value && typeof value === "object" && "toNumber" in value ? Number(value) : value]),
  ) as T;
}
