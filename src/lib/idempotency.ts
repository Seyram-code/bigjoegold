import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type IdempotentResult<T> = { value: T; status: number; replayed: boolean };
const RETENTION_DAYS = 30;
let cleanupScheduled = false;

function scheduleIdempotencyCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  queueMicrotask(async () => {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
    } catch (error) {
      console.error("Unable to remove expired idempotency records", error);
    } finally {
      cleanupScheduled = false;
    }
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new HttpError("The request cannot be stored safely", 400);
}

function jsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  const serialized = JSON.parse(JSON.stringify(value)) as JsonValue;
  return serialized === null ? Prisma.JsonNull : serialized as Prisma.InputJsonValue;
}

export async function runIdempotent<T>(
  request: Request,
  userId: string,
  route: string,
  input: unknown,
  operation: () => Promise<{ value: T; status?: number }>,
): Promise<IdempotentResult<T>> {
  scheduleIdempotencyCleanup();
  const key = request.headers.get("idempotency-key");
  if (!key) {
    const result = await operation();
    return { value: result.value, status: result.status ?? 200, replayed: false };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new HttpError("Invalid Idempotency-Key header", 400);

  const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  try {
    await prisma.idempotencyRecord.create({ data: { userId, route, key, requestHash } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.idempotencyRecord.findUnique({ where: { userId_route_key: { userId, route, key } } });
    if (!existing || existing.requestHash !== requestHash) throw new HttpError("This Idempotency-Key was already used for a different request", 409);
    if (existing.state === "COMPLETED" && existing.response !== null && existing.statusCode) {
      return { value: existing.response as T, status: existing.statusCode, replayed: true };
    }
    throw new HttpError("This request is still being processed. Wait before retrying.", 409, 5);
  }

  const result = await operation();
  const status = result.status ?? 200;
  await prisma.idempotencyRecord.update({
    where: { userId_route_key: { userId, route, key } },
    data: { state: "COMPLETED", statusCode: status, response: jsonValue(result.value), completedAt: new Date() },
  });
  return { value: result.value, status, replayed: false };
}
