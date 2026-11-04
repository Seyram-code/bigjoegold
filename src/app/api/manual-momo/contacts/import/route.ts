import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import {
  formatManualMomoContactPhone,
  MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS,
  normalizeManualMomoPhone,
} from "@/lib/manual-momo-contacts";
import { prisma } from "@/lib/prisma";
import { manualMomoContactImportRowSchema } from "@/lib/validation";

const importRequestSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2),
    data: z.unknown(),
  }).strict()).min(1).max(MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS),
}).strict();

const issueMessage = (error: z.ZodError) =>
  [...new Set(error.issues.map((issue) => issue.message))].join("; ");

type ImportOutcome = {
  rowNumber: number;
  status: "pending" | "imported" | "duplicate" | "invalid";
  input?: z.infer<typeof manualMomoContactImportRowSchema>;
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const body = importRequestSchema.parse(await readJson(request, 6 * 1024 * 1024));
    const outcomes: ImportOutcome[] = body.rows.map(({ rowNumber, data }) => {
      const parsed = manualMomoContactImportRowSchema.safeParse(data);
      return parsed.success
        ? { rowNumber, input: parsed.data, status: "pending" }
        : { rowNumber, reason: issueMessage(parsed.error), status: "invalid" };
    });
    const validRows = outcomes.filter((outcome): outcome is ImportOutcome & { input: NonNullable<ImportOutcome["input"]> } => Boolean(outcome.input));
    const knownPhones = new Set(
      (await prisma.manualMomoContact.findMany({ where: { phoneNormalized: { not: null } }, select: { phoneNormalized: true } }))
        .flatMap(({ phoneNormalized }) => phoneNormalized ? [phoneNormalized] : []),
    );

    for (const outcome of validRows) {
      const phone = normalizeManualMomoPhone(outcome.input.phone);
      if (phone && knownPhones.has(phone)) {
        outcome.status = "duplicate";
        outcome.reason = "Phone number already belongs to a Manual Bank & MOMO contact";
      } else if (phone) {
        knownPhones.add(phone);
      }
    }

    const readyRows = outcomes.filter((outcome) => outcome.status === "pending");
    if (readyRows.length) {
      await prisma.$transaction(async (tx) => {
        for (const outcome of readyRows) {
          if (!outcome.input) throw new Error("A validated import row is missing its contact data");
          const phone = outcome.input.phone ? formatManualMomoContactPhone(outcome.input.phone) : null;
          const created = await tx.manualMomoContact.create({
            data: {
              name: outcome.input.name,
              phone,
              phoneNormalized: normalizeManualMomoPhone(phone),
              email: outcome.input.email || null,
              notes: outcome.input.notes || null,
              createdById: user.id,
            },
          });
          await addAudit(tx, {
            userId: user.id,
            action: "manual-momo.contact.created",
            entity: "ManualMomoContact",
            entityId: created.id,
            details: { name: created.name, phone: created.phone, source: "excel_import" },
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
