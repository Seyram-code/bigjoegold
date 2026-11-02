import { after } from "next/server";
import { assertPermission, requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { correctSale } from "@/lib/sales";
import { saleCorrectionSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { sendOwnerTransactionEmail } from "@/lib/email";

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
