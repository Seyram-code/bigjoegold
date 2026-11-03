import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";

export function customerNameInitials(name: string) {
  const words = name.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  return words.map((word) => Array.from(word)[0]?.toLocaleUpperCase("en")).join("") || "X";
}

export function generateCustomerCode(name: string) {
  const initials = customerNameInitials(name);
  const suffix = randomInt(0, 100_000).toString().padStart(5, "0");
  return `BJG-${initials}-${suffix}`;
}

export async function generateUniqueCustomerCode(tx: Prisma.TransactionClient, name: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCustomerCode(name);
    const existing = await tx.customer.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new HttpError("Unable to generate a unique customer ID. Please try again.", 503);
}
