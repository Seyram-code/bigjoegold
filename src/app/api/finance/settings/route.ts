import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { addAudit } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { financeSettingsSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireUser("finance:manage");
    const settings = await prisma.financeConfig.findUnique({ where: { id: "default" } });
    return Response.json({
      adjustmentApprovalThreshold: settings?.adjustmentApprovalThreshold?.toFixed(2) ?? "",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser("finance:manage");
    const input = financeSettingsSchema.parse(await readJson(request));
    const adjustmentApprovalThreshold = input.adjustmentApprovalThreshold ? input.adjustmentApprovalThreshold : null;
    const settings = await prisma.$transaction(async (tx) => {
      const previous = await tx.financeConfig.findUnique({ where: { id: "default" } });
      const result = await tx.financeConfig.upsert({
        where: { id: "default" },
        create: { id: "default", adjustmentApprovalThreshold },
        update: { adjustmentApprovalThreshold },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "finance.approval_thresholds.updated",
        entity: "FinanceConfig",
        entityId: "default",
        details: {
          before: { adjustmentApprovalThreshold: previous?.adjustmentApprovalThreshold?.toString() ?? null },
          after: { adjustmentApprovalThreshold: result.adjustmentApprovalThreshold?.toString() ?? null },
        },
      });
      return result;
    });
    return Response.json({
      adjustmentApprovalThreshold: settings.adjustmentApprovalThreshold?.toFixed(2) ?? "",
    });
  } catch (error) {
    return apiError(error);
  }
}
