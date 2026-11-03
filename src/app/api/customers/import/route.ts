import { z } from "zod";
import { addAudit } from "@/lib/records";
import { assertPermission, requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { generateUniqueCustomerCode } from "@/lib/customer-code";
import { prisma } from "@/lib/prisma";
import {
  customerImportRowSchema,
  formatImportedPhone,
  MAX_CUSTOMER_IMPORT_ROWS,
  normalizeImportedPhone,
  type CustomerImportInput,
} from "@/lib/customer-import";

const importRequestSchema = z.object({
  kind: z.enum(["BUYER", "SUPPLIER"]),
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2),
    data: z.unknown(),
  }).strict()).min(1).max(MAX_CUSTOMER_IMPORT_ROWS),
}).strict();

const rowError = (error: z.ZodError) =>
  [...new Set(error.issues.map((issue) => issue.message))].join("; ");

function customerCreateData(input: CustomerImportInput, kind: "BUYER" | "SUPPLIER", code: string) {
  return {
    code,
    name: input.name,
    type: input.type,
    kind,
    phone: formatImportedPhone(input.phone),
    alternativePhone: input.alternativePhone || null,
    email: input.email || null,
    dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
    gender: input.gender || null,
    idType: input.idType || null,
    idNumber: input.idNumber || null,
    tin: input.tin || null,
    address: input.address || null,
    addressLine1: input.addressLine1 || null,
    addressLine2: input.addressLine2 || null,
    city: input.city || null,
    region: input.region || null,
    country: input.country || "Ghana",
    gpsLocation: input.gpsLocation || null,
    notes: input.notes || null,
  };
}

type ImportOutcome = {
  rowNumber: number;
  status: "pending" | "imported" | "duplicate" | "invalid";
  input?: CustomerImportInput;
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const user = await requireUser("customers:write");
    assertPermission(user, "customers:personal:read");
    const requestBody = importRequestSchema.parse(await readJson(request, 6 * 1024 * 1024));

    const outcomes: ImportOutcome[] = requestBody.rows.map(({ rowNumber, data }) => {
      const parsed = customerImportRowSchema.safeParse(data);
      return parsed.success
        ? { rowNumber, input: parsed.data, status: "pending" as const }
        : { rowNumber, reason: rowError(parsed.error), status: "invalid" as const };
    });
    const validRows = outcomes.filter((outcome): outcome is ImportOutcome & { input: CustomerImportInput } => Boolean(outcome.input));

    const existing = validRows.length
      ? await prisma.customer.findMany({
        where: { kind: requestBody.kind },
        select: { phone: true, alternativePhone: true },
      })
      : [];
    const knownPhones = new Set(
      existing.flatMap(({ phone, alternativePhone }) =>
        [phone, alternativePhone].filter((value): value is string => Boolean(value)).map(normalizeImportedPhone),
      ),
    );

    for (const outcome of validRows) {
      const phones = [outcome.input.phone, outcome.input.alternativePhone ?? ""]
        .map(normalizeImportedPhone)
        .filter((phone) => phone.length >= 5);
      if (phones.some((phone) => knownPhones.has(phone))) {
        outcome.status = "duplicate";
        outcome.reason = "Phone number already belongs to a customer";
      } else {
        phones.forEach((phone) => knownPhones.add(phone));
      }
    }

    const readyRows = outcomes.filter((outcome) => outcome.status === "pending");
    if (readyRows.length) {
      await prisma.$transaction(async (tx) => {
        for (const outcome of readyRows) {
          if (!outcome.input) throw new Error("A validated import row is missing its customer data");
          const code = await generateUniqueCustomerCode(tx, outcome.input.name);
          const created = await tx.customer.create({ data: customerCreateData(outcome.input, requestBody.kind, code) });
          await addAudit(tx, {
            userId: user.id,
            action: "customer.created",
            entity: "Customer",
            entityId: created.id,
            details: { code: created.code, kind: created.kind, source: "excel_import" },
          });
          outcome.status = "imported";
        }
      }, { maxWait: 10_000, timeout: 30_000 });
    }

    const rows = outcomes.map(({ rowNumber, status, reason }) => ({
      rowNumber,
      status,
      ...(reason ? { reason } : {}),
    }));
    return Response.json({
      imported: rows.filter((row) => row.status === "imported").length,
      skipped: rows.filter((row) => row.status !== "imported").length,
      rows,
    });
  } catch (error) {
    return apiError(error);
  }
}
