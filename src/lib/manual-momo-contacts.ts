import { z } from "zod";
import { manualMomoContactImportRowSchema } from "@/lib/validation";

export const MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS = 500;

export const MANUAL_MOMO_CONTACT_IMPORT_COLUMNS = [
  { header: "Contact Name", key: "name" },
  { header: "Phone Number", key: "phone" },
  { header: "Email Address", key: "email" },
  { header: "Notes", key: "notes" },
] as const;

export type ManualMomoContactImportField = typeof MANUAL_MOMO_CONTACT_IMPORT_COLUMNS[number]["key"];
export type ManualMomoContactImportInput = z.infer<typeof manualMomoContactImportRowSchema>;

const HEADER_FIELDS: Record<string, ManualMomoContactImportField> = {
  contactname: "name",
  customername: "name",
  fullname: "name",
  name: "name",
  phonenumber: "phone",
  phone: "phone",
  mobilenumber: "phone",
  emailaddress: "email",
  email: "email",
  notes: "notes",
  note: "notes",
};

export function manualMomoContactImportFieldForHeader(header: unknown): ManualMomoContactImportField | undefined {
  if (typeof header !== "string") return undefined;
  return HEADER_FIELDS[header.trim().toLowerCase().replace(/[^a-z0-9]/g, "")];
}

export function normalizeManualMomoPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.startsWith("233") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export function formatManualMomoContactPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `+233 ${digits.slice(3)}`;
  if (digits.startsWith("0") && digits.length === 10) return `+233 ${digits.slice(1)}`;
  if (digits.length === 9) return `+233 ${digits}`;
  return trimmed;
}
