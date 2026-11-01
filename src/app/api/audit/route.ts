import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requireUser("audit:read");
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { user: { select: { name: true, email: true } } },
    });
    return Response.json(logs);
  } catch (error) {
    return apiError(error);
  }
}
