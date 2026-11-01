import { randomInt } from "node:crypto";

export function customerNameInitials(name: string) {
  const words = name.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  return words.map((word) => Array.from(word)[0]?.toLocaleUpperCase("en")).join("") || "X";
}

export function generateCustomerCode(name: string) {
  const initials = customerNameInitials(name);
  const suffix = randomInt(0, 100_000).toString().padStart(5, "0");
  return `BJG-${initials}-${suffix}`;
}
