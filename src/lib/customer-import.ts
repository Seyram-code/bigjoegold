import { z } from "zod";
import { customerSchema } from "@/lib/validation";

export const MAX_CUSTOMER_IMPORT_ROWS = 500;

export const customerImportRowSchema = customerSchema
  .omit({ kind: true })
  .extend({
    type: z.enum(["INDIVIDUAL", "BUSINESS"]).default("INDIVIDUAL"),
    phone: z.string().trim().min(1, "Phone number is required").max(500)
      .refine((value) => {
        const digits = value.replace(/\D/g, "").length;
        return digits >= 5 && digits <= 15;
      }, "Enter a valid phone number"),
  });

export type CustomerImportInput = z.infer<typeof customerImportRowSchema>;

export const CUSTOMER_IMPORT_COLUMNS = [
  { header: "Customer Full Name", key: "name" },
  { header: "Phone Number", key: "phone" },
  { header: "Customer Type", key: "type" },
  { header: "Alternative Phone", key: "alternativePhone" },
  { header: "Email Address", key: "email" },
  { header: "Date of Birth", key: "dateOfBirth" },
  { header: "Gender", key: "gender" },
  { header: "ID Type", key: "idType" },
  { header: "ID Number", key: "idNumber" },
  { header: "TIN", key: "tin" },
  { header: "Address", key: "address" },
  { header: "Address Line 1", key: "addressLine1" },
  { header: "Address Line 2", key: "addressLine2" },
  { header: "City", key: "city" },
  { header: "Region", key: "region" },
  { header: "Country", key: "country" },
  { header: "GPS Location", key: "gpsLocation" },
  { header: "Notes", key: "notes" },
] as const;

export type CustomerImportField = typeof CUSTOMER_IMPORT_COLUMNS[number]["key"];

const HEADER_FIELDS: Record<string, CustomerImportField> = {
  customerfullname: "name",
  fullname: "name",
  name: "name",
  phonenumber: "phone",
  phone: "phone",
  customertype: "type",
  type: "type",
  alternativephone: "alternativePhone",
  emailaddress: "email",
  email: "email",
  dateofbirth: "dateOfBirth",
  gender: "gender",
  idtype: "idType",
  idnumber: "idNumber",
  tin: "tin",
  address: "address",
  addressline1: "addressLine1",
  addressline2: "addressLine2",
  city: "city",
  region: "region",
  country: "country",
  gpslocation: "gpsLocation",
  notes: "notes",
};

export function customerImportFieldForHeader(header: unknown): CustomerImportField | undefined {
  if (typeof header !== "string") return undefined;
  const normalized = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return HEADER_FIELDS[normalized];
}

export function normalizeCustomerImportValue(field: CustomerImportField, value: string) {
  const trimmed = value.trim();
  const uppercase = trimmed.toUpperCase();
  if (field === "type") return uppercase;
  if (field === "gender") return uppercase.replace(/[\s-]+/g, "_");
  if (field === "idType") {
    const compact = uppercase.replace(/[^A-Z0-9]/g, "");
    return ({
      GHANACARD: "GHANA_CARD",
      DRIVERLICENSE: "DRIVERS_LICENSE",
      DRIVERSLICENSE: "DRIVERS_LICENSE",
      VOTERID: "VOTER_ID",
    } as Record<string, string>)[compact] ?? uppercase;
  }
  return trimmed;
}

export function normalizeImportedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("233") && digits.length === 12) return digits.slice(3);
  if (digits.startsWith("0") && digits.length === 10) return digits.slice(1);
  return digits;
}

export function formatImportedPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 9) return `+233 ${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+233 ${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+233 ${digits.slice(3)}`;
  return trimmed;
}
