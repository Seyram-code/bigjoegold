import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { correctSale } from "@/lib/sales";
import { saleCorrectionSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { sendOwnerTransactionEmail } from "@/lib/email";
import { sendOwnerPaymentSms } from "@/lib/sms";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await enforceUserRateLimit(user.id, "sale-correction", { limit: 10 });
    const { id } = await context.params;
    const input = saleCorrectionSchema.parse(await readJson(request));
    assertPermission(user, input.type === "REVERSAL" ? "transactions:reverse" : "sales:write");
    const correction = await correctSale(user.id, id, input);
    after(async () => {
      if (new Prisma.Decimal(correction.refundAmount).greaterThan(0)) {
        try {
          const refundPayment = await prisma.payment.findFirst({
            where: { saleCorrectionId: correction.id },
            select: { id: true },
          });
          if (refundPayment) await sendOwnerPaymentSms(refundPayment.id, user.name);
        } catch (error) {
          console.error("Sale refund was recorded, but its owner SMS could not be prepared.", error);
        }
      }
      await sendOwnerTransactionEmail({
        type: "SALE_CORRECTION",
        reference: correction.reference,
        saleReference: correction.trade.reference,
        correctionType: correction.type,
        customerName: correction.trade.customer?.name,
        quantityKg: correction.quantityGrams.div(1000).toString(),
        creditAmount: correction.creditAmount.toString(),
        refundAmount: correction.refundAmount.toString(),
        recordedBy: correction.createdBy.name,
      });
    });
    return Response.json(correction, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
