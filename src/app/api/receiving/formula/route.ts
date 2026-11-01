import { requireUser } from "@/lib/authz";
import { apiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { purchaseFormulaRules } from "@/lib/purchase-formula";

export async function GET() {
  try {
    await requireUser("trades:read");
    const stored = await prisma.purchaseFormulaConfig.findUnique({ where: { id: "default" } });
    return Response.json(purchaseFormulaRules(stored));
  } catch (error) {
    return apiError(error);
  }
}
