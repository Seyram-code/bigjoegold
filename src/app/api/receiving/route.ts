import { after } from "next/server";
import { can, requireUser, userCan } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { prepareReceivingForSave } from "@/lib/receiving";
import { receivingSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { purchaseConfirmationSms, sendOwnerSms } from "@/lib/sms";
import { sendOwnerTransactionEmail } from "@/lib/email";

export async function GET() {
  try {
    const user = await requireUser("trades:read");
    const records = await prisma.trade.findMany({
      where: { type: "PURCHASE", status: { in: ["DRAFT", "POSTED"] }, purchaseMeasurement: { isNot: null } },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 250,
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            ...(can(user.role, "customers:personal:read", user.permissions) ? { phone: true, email: true, address: true } : {}),
          },
        },
        createdBy: { select: { name: true } },
        boardPrice: { select: { priceAmount: true, currency: true, priceUnit: true, effectiveAt: true } },
        payments: { select: { amount: true, method: true, paidAt: true } },
        buyerFinanceSettlement: {
          select: { reference: true, amount: true, account: { select: { reference: true, customer: { select: { name: true, code: true } } } } },
        },
        purchaseMeasurement: true,
      },
    });
    return Response.json(records.map(({ purchaseMeasurement, ...record }) => ({
      ...record,
      topGrams: purchaseMeasurement?.topKg.mul(1000) ?? null,
      downGrams: purchaseMeasurement?.downKg.mul(1000) ?? null,
      pounds: purchaseMeasurement?.pounds ?? null,
      density: purchaseMeasurement?.density ?? null,
      karat: purchaseMeasurement?.karat ?? null,
      formulaVersion: purchaseMeasurement?.formulaVersion ?? null,
    })));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("purchases:write");
    await enforceUserRateLimit(user.id, "purchase-write", { limit: 20 });
    const input = receivingSchema.parse(await readJson(request));
    if (input.financingAccountId && !userCan(user, "payments:write")) {
      throw new Response("You do not have permission to apply buyer financing", { status: 403 });
    }
    const trade = await prepareReceivingForSave(user.id, input);
    if (trade.status === "POSTED") {
      after(async () => {
        try {
          const supplier = await prisma.customer.findUnique({ where: { id: trade.customerId ?? "" }, select: { name: true } });
          await sendOwnerSms(purchaseConfirmationSms({
            reference: trade.reference,
            supplierName: supplier?.name ?? "Unknown supplier",
            quantityKg: trade.quantityKg.toString(),
            totalAmount: trade.totalAmount.toString(),
            amountPaid: trade.paymentAmount.toString(),
            recordedBy: user.name,
          }));
          await sendOwnerTransactionEmail({
            type: "PURCHASE",
            reference: trade.reference,
            counterpartyLabel: "Supplier",
            counterpartyName: supplier?.name ?? "Unknown supplier",
            quantityKg: trade.quantityKg.toString(),
            totalAmount: trade.totalAmount.toString(),
            amountPaid: trade.paymentAmount.toString(),
            recordedBy: user.name,
          });
        } catch (error) {
          console.error("Purchase was saved, but its owner notifications could not be prepared.", error);
        }
      });
    }
    return Response.json(trade, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
