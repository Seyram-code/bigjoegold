import { PaymentDirection, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { manualMomoClosingSummarySms, sendOwnerSms } from "@/lib/sms";

export async function POST(request: Request) {
  try {
    const user = await requireUser("payments:write");
    const body = await readJson(request);
    if (
      typeof body !== "object"
      || body === null
      || !("closingDate" in body)
      || typeof body.closingDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(body.closingDate)
      || Object.keys(body).length !== 1
    ) {
      throw new HttpError("Select a valid business closing date", 400);
    }

    const closingDate = body.closingDate;
    const dayStart = new Date(`${closingDate}T00:00:00.000Z`);
    if (Number.isNaN(dayStart.getTime()) || dayStart.toISOString().slice(0, 10) !== closingDate) {
      throw new HttpError("Select a valid business closing date", 400);
    }
    if (dayStart > new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z")) {
      throw new HttpError("Closing date cannot be in the future", 400);
    }
    const closingAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const accounts = await prisma.$transaction(async (tx) => {
      const ledgers = await tx.manualMomoAccount.findMany({
        orderBy: { name: "asc" },
      });
      if (ledgers.length === 0) return [];

      const movements = await tx.manualMomoEntry.groupBy({
        by: ["accountId", "direction"],
        where: { transactionDate: { lte: closingAt } },
        _sum: { amount: true },
      });
      const balances = new Map(ledgers.filter((account) => account.openingDate <= closingAt).map((account) => [
        account.id,
        account.openingBalance,
      ]));
      for (const movement of movements) {
        const balance = balances.get(movement.accountId);
        if (!balance) continue;
        const amount = movement._sum.amount ?? new Prisma.Decimal(0);
        balances.set(
          movement.accountId,
          movement.direction === PaymentDirection.INBOUND ? balance.plus(amount) : balance.minus(amount),
        );
      }

      return ledgers.map((account) => ({
        name: account.name,
        type: account.type,
        balance: (balances.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
      }));
    });

    if (accounts.length === 0) throw new HttpError("Create at least one ledger before closing the business day", 409);

    const messages = manualMomoClosingSummarySms(closingDate, accounts, user.name);
    let queuedMessages = 0;
    for (const message of messages) {
      if (!await sendOwnerSms(message)) {
        const detail = queuedMessages
          ? `${queuedMessages} of ${messages.length} closing SMS messages were accepted; some may already be queued. Check before retrying.`
          : "The closing SMS could not be queued. Check the owner SMS configuration and try again.";
        throw new HttpError(detail, 502);
      }
      queuedMessages += 1;
    }
    return Response.json({ queued: true, queuedMessages, closingDate, accountCount: accounts.length });
  } catch (error) {
    return apiError(error);
  }
}
