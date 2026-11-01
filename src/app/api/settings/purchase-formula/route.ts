import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PURCHASE_FORMULA_RULES, purchaseFormulaRules } from "@/lib/purchase-formula";
import { purchaseFormulaSettingsSchema } from "@/lib/validation";

const formulaFields = [
  "poundsKgDivisor",
  "densityReference",
  "karatMultiplier",
  "karatDiscountMultiplier",
  "amountKaratDivisor",
] as const;

function formulaVersion(version: string) {
  const match = /^(.*-)(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("Stored purchase formula version has an unsupported format");
  return `${match[1]}${match[2]}.${match[3]}.${Number(match[4]) + 1}`;
}

export async function GET() {
  try {
    await requireUser("settings:manage");
    const stored = await prisma.purchaseFormulaConfig.findUnique({ where: { id: "default" } });
    return Response.json(purchaseFormulaRules(stored));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser("settings:manage");
    const input = purchaseFormulaSettingsSchema.parse(await readJson(request));
    const settings = await prisma.$transaction(async (tx) => {
      const previous = await tx.purchaseFormulaConfig.findUnique({ where: { id: "default" } });
      const priorRules = purchaseFormulaRules(previous);
      const changed = formulaFields.some((field) => new Prisma.Decimal(input[field]).comparedTo(priorRules[field]) !== 0);
      const baseVersion = priorRules.version === DEFAULT_PURCHASE_FORMULA_RULES.version
        ? priorRules.version
        : DEFAULT_PURCHASE_FORMULA_RULES.version;
      const version = changed ? formulaVersion(baseVersion) : baseVersion;
      const result = await tx.purchaseFormulaConfig.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          version,
          ownerConfirmed: input.ownerConfirmed,
          poundsKgDivisor: new Prisma.Decimal(input.poundsKgDivisor),
          densityReference: new Prisma.Decimal(input.densityReference),
          karatMultiplier: new Prisma.Decimal(input.karatMultiplier),
          karatDiscountMultiplier: new Prisma.Decimal(input.karatDiscountMultiplier),
          amountKaratDivisor: new Prisma.Decimal(input.amountKaratDivisor),
        },
        update: {
          version,
          ownerConfirmed: input.ownerConfirmed,
          poundsKgDivisor: new Prisma.Decimal(input.poundsKgDivisor),
          densityReference: new Prisma.Decimal(input.densityReference),
          karatMultiplier: new Prisma.Decimal(input.karatMultiplier),
          karatDiscountMultiplier: new Prisma.Decimal(input.karatDiscountMultiplier),
          amountKaratDivisor: new Prisma.Decimal(input.amountKaratDivisor),
        },
      });
      const nextRules = purchaseFormulaRules(result);
      await addAudit(tx, {
        userId: user.id,
        action: "settings.purchase_formula.updated",
        entity: "PurchaseFormulaConfig",
        entityId: "default",
        details: {
          before: { ...priorRules },
          after: { ...nextRules },
        } as Prisma.InputJsonObject,
      });
      return nextRules;
    });
    return Response.json(settings);
  } catch (error) {
    return apiError(error);
  }
}
