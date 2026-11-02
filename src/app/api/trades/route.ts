import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { addAudit, generateBatchNumber, reference } from "@/lib/records";
import { assertPermission, can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { calculateTradeAmount, planFifo } from "@/lib/gold";
import { tradeSchema } from "@/lib/validation";
import { ledgerBalances, resolveStorageLocation } from "@/lib/inventory";
import { recordPaymentMovement } from "@/lib/finance";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { sendOwnerTransactionEmail } from "@/lib/email";

export async function GET(request: Request) {
  try {
    await requireUser("trades:read");
    const typeFilter = new URL(request.url).searchParams.get("type");
    if (typeFilter && typeFilter !== "SALE" && typeFilter !== "PURCHASE") {
      throw new HttpError("Trade type filter must be SALE or PURCHASE", 400);
    }
    const trades = await prisma.trade.findMany({
      where: typeFilter
        ? typeFilter === "SALE"
          ? { type: "SALE", status: { in: ["POSTED", "RETURNED", "VOIDED"] } }
          : { type: "PURCHASE", status: "POSTED" }
        : { OR: [{ status: "POSTED" }, { type: "SALE", status: { in: ["RETURNED", "VOIDED"] } }] },
      orderBy: { createdAt: "desc" },
      take: 250,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        createdBy: { select: { name: true } },
        payments: { select: { amount: true, direction: true } },
        corrections: { select: { creditAmount: true, refundAmount: true } },
      },
    });
    return Response.json(trades);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceUserRateLimit(user.id, "trade-post", { limit: 20 });
    const input = tradeSchema.parse(await readJson(request));
    if (input.type === "PURCHASE") {
      throw new HttpError("Use the Receive Stock workflow to create purchases. Direct purchase posting is disabled.", 409);
    }
    if (!can(user.role, "sales:write", user.permissions)) assertPermission(user, "trades:write");
    const { kg, grossGrams, total } = calculateTradeAmount(input.quantityKg, input.purityBps, input.pricePerGram);
    const initialPayment = new Prisma.Decimal(String(input.initialPayment));
    if (initialPayment.greaterThan(total)) throw new HttpError("Initial payment cannot exceed the trade amount", 400);
    if (input.customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!customer || !customer.isActive || customer.kind !== "BUYER") throw new HttpError("Select an active buyer", 400);
    }

    const trade = await prisma.$transaction(async (tx) => {
      let costBasis = new Prisma.Decimal(0);
      const created = await tx.trade.create({
        data: {
          reference: reference(input.type === "PURCHASE" ? "PUR" : "SAL"),
          type: input.type,
          customerId: input.customerId || null,
          quantityKg: kg,
          purityBps: input.purityBps,
          pricePerGram: input.pricePerGram,
          totalAmount: total,
          note: input.note || null,
          createdById: user.id,
        },
      });

      if (input.type === "PURCHASE") {
        const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
        const storageLocation = await resolveStorageLocation(tx, "Main storage", user.id);
        const inventoryLot = await tx.inventoryLot.create({
          data: {
            tradeId: created.id,
            batchNumber: await generateBatchNumber(tx),
            source: customer?.name ?? "Purchase",
            receivedAt: created.transactionDate,
            originalGrams: grossGrams.toDecimalPlaces(5),
            remainingGrams: grossGrams.toDecimalPlaces(5),
            costPerGram: total.div(grossGrams).toDecimalPlaces(6),
            purityBps: input.purityBps,
            storageLocationId: storageLocation.id,
          },
        });
        await tx.stockMovement.create({
          data: {
            reference: reference("MOV"),
            type: "PURCHASE_RECEIPT",
            tradeId: created.id,
            inventoryLotId: inventoryLot.id,
            locationId: storageLocation.id,
            quantityGrams: grossGrams.toDecimalPlaces(5),
            movementDate: created.transactionDate,
            reason: "Received purchase stock",
            createdById: user.id,
          },
        });
      } else {
        await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM InventoryLot WHERE remainingGrams > 0 ORDER BY createdAt ASC, id ASC FOR UPDATE`;
        const lots = await tx.inventoryLot.findMany({
          where: { remainingGrams: { gt: 0 }, status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const movements = await tx.stockMovement.groupBy({
          by: ["inventoryLotId", "type"],
          where: { inventoryLotId: { in: lots.map((lot) => lot.id) } },
          _sum: { quantityGrams: true },
        });
        const balances = ledgerBalances(movements.map((movement) => ({
          inventoryLotId: movement.inventoryLotId,
          type: movement.type,
          quantityGrams: movement._sum.quantityGrams ?? new Prisma.Decimal(0),
        })));
        if (lots.some((lot) => !(balances.get(lot.id) ?? new Prisma.Decimal(0)).equals(lot.remainingGrams))) {
          throw new HttpError("Stock batch balances do not match the stock ledger. Reconcile inventory before selling.", 409);
        }
        const plan = planFifo(lots, grossGrams);
        if (plan.remainingGrams.greaterThan(0)) throw new HttpError("Not enough gold in stock for this sale", 409);
        for (const allocation of plan.allocations) {
          const lot = lots.find((candidate) => candidate.id === allocation.lotId);
          if (!lot) throw new Error("FIFO allocation referenced a missing inventory lot");
          await tx.inventoryLot.update({
            where: { id: allocation.lotId },
            data: {
              remainingGrams: new Prisma.Decimal(lot.remainingGrams).minus(allocation.grams),
              status: new Prisma.Decimal(lot.remainingGrams).minus(allocation.grams).isZero() ? "DEPLETED" : "ACTIVE",
            },
          });
          await tx.inventoryAllocation.create({
            data: { tradeId: created.id, lotId: allocation.lotId, grams: allocation.grams, costAmount: allocation.costAmount },
          });
          await tx.stockMovement.create({
            data: {
              reference: reference("MOV"),
              type: "SALE_ISSUE",
              tradeId: created.id,
              inventoryLotId: allocation.lotId,
              locationId: lot.storageLocationId,
              quantityGrams: allocation.grams,
              movementDate: created.transactionDate,
              reason: "Sale issue",
              createdById: user.id,
            },
          });
          costBasis = costBasis.plus(allocation.costAmount);
        }
        costBasis = plan.costBasis;
        await tx.trade.update({ where: { id: created.id }, data: { costBasis } });
      }

      if (initialPayment.greaterThan(0)) {
        const payment = await tx.payment.create({
          data: {
            reference: reference("PAY"),
            direction: input.type === "SALE" ? "INBOUND" : "OUTBOUND",
            amount: initialPayment,
            method: input.method,
            cashAccountId: input.cashAccountId || null,
            tradeId: created.id,
            customerId: input.customerId || null,
            createdById: user.id,
          },
        });
        await recordPaymentMovement(tx, {
          paymentId: payment.id,
          cashAccountId: input.cashAccountId,
          direction: payment.direction,
          amount: payment.amount,
          movementDate: payment.paidAt,
          description: `${input.type === "SALE" ? "Sale" : "Purchase"} payment for ${created.reference}`,
          createdById: user.id,
        });
      }
      await addAudit(tx, {
        userId: user.id,
        action: `trade.${input.type.toLowerCase()}.posted`,
        entity: "Trade",
        entityId: created.id,
        details: { reference: created.reference, quantityKg: input.quantityKg, amount: total.toString() },
      });
      return tx.trade.findUniqueOrThrow({
        where: { id: created.id },
        include: { customer: { select: { name: true } }, payments: true },
      });
    });
    if (trade.type === "SALE") {
      const amountPaid = trade.payments
        .filter((payment) => payment.direction === "INBOUND")
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
      after(async () => {
        await sendOwnerTransactionEmail({
          type: "SALE",
          reference: trade.reference,
          customerName: trade.customer?.name,
          quantityKg: trade.quantityKg.toString(),
          totalAmount: trade.totalAmount.toString(),
          amountPaid: amountPaid.toString(),
          recordedBy: user.name,
        });
      });
    }
    return Response.json(trade, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
