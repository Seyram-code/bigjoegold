import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { addAudit } from "@/lib/records";
import { requireUser } from "@/lib/authz";
import { apiError, readJson } from "@/lib/http";
import { boardPriceSchema } from "@/lib/validation";
import { enforceUserRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    const currentOnly = new URL(request.url).searchParams.get("current") === "1";
    await requireUser(currentOnly ? "dashboard:read" : "board:read");
    if (currentOnly) {
      const now = new Date();
      const [selling, receiving] = await Promise.all((["SELLING", "RECEIVING"] as const).map((priceType) =>
        prisma.goldBoardPrice.findFirst({
          where: { priceType, effectiveAt: { lte: now } },
          orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: { priceAmount: true, currency: true },
        }),
      ));
      return Response.json({
        selling: selling ? { amount: selling.priceAmount.toString(), currency: selling.currency } : null,
        receiving: receiving ? { amount: receiving.priceAmount.toString(), currency: receiving.currency } : null,
      });
    }
    const prices = await prisma.goldBoardPrice.findMany({
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return Response.json(prices);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("board:write");
    await enforceUserRateLimit(user.id, "board-price-write", { limit: 10 });
    const input = boardPriceSchema.parse(await readJson(request));
    const price = await prisma.$transaction(async (tx) => {
      const latest = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\` FROM \`GoldBoardPrice\`
        WHERE \`priceType\` = ${input.priceType}
        ORDER BY \`effectiveAt\` DESC, \`createdAt\` DESC, \`id\` DESC
        LIMIT 1 FOR UPDATE
      `);
      if ((latest[0]?.id ?? null) !== input.expectedCurrentPriceId) {
        throw new Error("CURRENT_BOARD_PRICE_CHANGED");
      }
      const previous = latest[0]
        ? await tx.goldBoardPrice.findUnique({ where: { id: latest[0].id } })
        : null;
      const created = await tx.goldBoardPrice.create({
        data: {
          priceType: input.priceType,
          priceAmount: input.priceAmount,
          currency: input.currency,
          priceUnit: input.priceUnit,
          source: input.source,
          note: input.note || null,
          effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
          createdById: user.id,
        },
      });
      await addAudit(tx, {
        userId: user.id,
        action: "board_price.published",
        entity: "GoldBoardPrice",
        entityId: created.id,
        details: {
          before: previous ? {
            priceAmount: previous.priceAmount.toString(),
            priceType: previous.priceType,
            currency: previous.currency,
            priceUnit: previous.priceUnit,
            source: previous.source,
            effectiveAt: previous.effectiveAt.toISOString(),
          } : null,
          after: {
            priceAmount: created.priceAmount.toString(),
            priceType: created.priceType,
            currency: created.currency,
            priceUnit: created.priceUnit,
            source: created.source,
            effectiveAt: created.effectiveAt.toISOString(),
          },
        },
      });
      return created;
    });
    return Response.json(price, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "CURRENT_BOARD_PRICE_CHANGED") {
      return Response.json({ error: "The current board price has changed. Reload the history and confirm the replacement again." }, { status: 409 });
    }
    return apiError(error);
  }
}
