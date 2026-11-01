import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { inventoryMovementSchema } from "@/lib/validation";
import { postInventoryMovement } from "@/lib/inventory";
import { enforceUserRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await requireUser("inventory:read");
    const search = new URL(request.url).searchParams;
    const requestedPage = Number(search.get("page") ?? "1");
    const requestedPageSize = Number(search.get("pageSize") ?? "100");
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isInteger(requestedPageSize) ? Math.min(200, Math.max(1, requestedPageSize)) : 100;
    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          trade: { select: { reference: true, customer: { select: { name: true, code: true } } } },
          inventoryLot: { select: { id: true, batchNumber: true, source: true } },
          location: { select: { name: true } },
          fromLocation: { select: { name: true } },
          toLocation: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
      prisma.stockMovement.count(),
    ]);
    return Response.json({ movements, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = inventoryMovementSchema.parse(await readJson(request));
    const permission = input.action === "TRANSFER" ? "inventory:transfer"
      : input.action === "RECONCILE" ? "inventory:reconcile"
        : "inventory:adjust";
    const user = await requireUser(permission);
    await enforceUserRateLimit(user.id, "inventory-write", { limit: 20 });
    const result = await prisma.$transaction((tx) => postInventoryMovement(tx, user.id, input));
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
