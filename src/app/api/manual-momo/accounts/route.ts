import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { manualMomoAccountCreateSchema, manualMomoAccountSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const input = manualMomoAccountCreateSchema.parse(await readJson(request));
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.manualMomoAccount.create({
        data: {
          type: input.type,
          name: input.name,
          bankNameTelco: input.type === "CASH" ? "" : input.bankNameTelco ?? "",
          accountNumber: input.type === "CASH" ? null : input.accountNumber || null,
          openingBalance: new Prisma.Decimal(input.openingBalance),
          openingDate: new Date(input.openingDate),
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.account.created",
        entity: "ManualMomoAccount",
        entityId: created.id,
        details: {
          name: created.name,
          type: created.type,
          bankNameTelco: created.bankNameTelco,
          accountNumber: created.accountNumber,
          openingBalance: created.openingBalance.toString(),
          openingDate: created.openingDate.toISOString(),
        },
      });
      return created;
    });

    return Response.json({
      id: account.id,
      name: account.name,
      type: account.type,
      bankNameTelco: account.bankNameTelco,
      accountNumber: account.accountNumber,
      openingBalance: account.openingBalance.toNumber(),
      openingDate: account.openingDate.toISOString(),
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const input = manualMomoAccountSchema.parse(await readJson(request));
    const account = await prisma.manualMomoAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new HttpError("The selected Manual Bank & MOMO account is unavailable", 409);

    const openingDate = new Date(input.openingDate);
    const earliestEntry = await prisma.manualMomoEntry.findFirst({
      where: { accountId: input.accountId },
      orderBy: { transactionDate: "asc" },
      select: { transactionDate: true },
    });
    if (earliestEntry && openingDate > earliestEntry.transactionDate) {
      throw new HttpError("Opening date must be on or before the earliest payment in this account.", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.manualMomoAccount.update({
        where: { id: input.accountId },
        data: { openingBalance: new Prisma.Decimal(input.openingBalance), openingDate },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.account.updated",
        entity: "ManualMomoAccount",
        entityId: saved.id,
        details: {
          openingBalance: saved.openingBalance.toString(),
          openingDate: saved.openingDate.toISOString(),
        },
      });
      return saved;
    });

    return Response.json({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      bankNameTelco: updated.bankNameTelco,
      accountNumber: updated.accountNumber,
      openingBalance: updated.openingBalance.toNumber(),
      openingDate: updated.openingDate.toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
