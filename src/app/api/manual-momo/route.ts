import { PaymentDirection, Prisma } from "@prisma/client";
import { after } from "next/server";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { addAudit, reference } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { sendOwnerManualMomoSms } from "@/lib/sms";
import { manualMomoEntrySchema } from "@/lib/validation";

function parseDateRange(url: URL) {
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError("Select a valid statement date range", 400);
  }
  const fromStart = new Date(`${from}T00:00:00.000Z`);
  const toStart = new Date(`${to}T00:00:00.000Z`);
  if (
    Number.isNaN(fromStart.getTime())
    || Number.isNaN(toStart.getTime())
    || fromStart.toISOString().slice(0, 10) !== from
    || toStart.toISOString().slice(0, 10) !== to
    || fromStart > toStart
  ) {
    throw new HttpError("The statement start date must be on or before its end date", 400);
  }
  const toDate = new Date(toStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { fromDate: fromStart, toDate };
}

export async function GET(request: Request) {
  try {
    await requireUser("payments:read");
    const url = new URL(request.url);
    const { fromDate, toDate } = parseDateRange(url);
    const [accounts, priorMovements, entries] = await Promise.all([
      prisma.manualMomoAccount.findMany({ orderBy: { name: "asc" } }),
      prisma.manualMomoEntry.groupBy({
        by: ["accountId", "direction"],
        where: { transactionDate: { lt: fromDate } },
        _sum: { amount: true },
      }),
      prisma.manualMomoEntry.findMany({
        where: { transactionDate: { gte: fromDate, lte: toDate } },
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const balancesBeforePeriod = new Map<string, Prisma.Decimal>();
    for (const account of accounts) {
      balancesBeforePeriod.set(
        account.id,
        account.openingDate < fromDate ? account.openingBalance : new Prisma.Decimal(0),
      );
    }
    for (const movement of priorMovements) {
      const current = balancesBeforePeriod.get(movement.accountId) ?? new Prisma.Decimal(0);
      const amount = movement._sum.amount ?? new Prisma.Decimal(0);
      balancesBeforePeriod.set(
        movement.accountId,
        movement.direction === PaymentDirection.INBOUND ? current.plus(amount) : current.minus(amount),
      );
    }

    return Response.json({
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        bankNameTelco: account.bankNameTelco,
        accountNumber: account.accountNumber,
        openingBalance: account.openingBalance.toNumber(),
        openingDate: account.openingDate.toISOString(),
        balanceBeforePeriod: (balancesBeforePeriod.get(account.id) ?? new Prisma.Decimal(0)).toNumber(),
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        reference: entry.reference,
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount.toNumber(),
        customerName: entry.customerName,
        customerPhone: entry.customerPhone,
        transactionReference: entry.transactionReference,
        transactionDate: entry.transactionDate.toISOString(),
        note: entry.note,
        createdBy: entry.createdBy.name,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const input = manualMomoEntrySchema.parse(await readJson(request));
    const account = await prisma.manualMomoAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new HttpError("The selected Manual Bank & MOMO account is unavailable", 409);

    const transactionDate = new Date(input.transactionDate);
    if (transactionDate < account.openingDate) {
      throw new HttpError("Payment date cannot be before this account's opening date", 400);
    }

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.manualMomoEntry.create({
        data: {
          reference: reference("MM"),
          accountId: input.accountId,
          direction: input.direction,
          amount: new Prisma.Decimal(input.amount),
          customerName: input.customerName,
          customerPhone: input.customerPhone || null,
          transactionReference: input.transactionReference || null,
          transactionDate,
          note: input.note || null,
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manual-momo.entry.created",
        entity: "ManualMomoEntry",
        entityId: created.id,
        details: {
          reference: created.reference,
          accountId: created.accountId,
          direction: created.direction,
          amount: created.amount.toString(),
          customerName: created.customerName,
        },
      });
      return created;
    });

    after(async () => {
      await sendOwnerManualMomoSms({
        reference: entry.reference,
        direction: entry.direction,
        amount: entry.amount.toString(),
        accountName: account.name,
        accountType: account.type,
        customerName: entry.customerName,
        transactionReference: entry.transactionReference,
        transactionDate: entry.transactionDate,
        recordedBy: user.name,
      });
    });

    return Response.json({ ...entry, amount: entry.amount.toNumber() }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
