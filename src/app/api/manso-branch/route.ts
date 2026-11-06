import { Prisma } from "@prisma/client";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { calculateCashBalances, recordPaymentMovement } from "@/lib/finance";
import { calculateMansoBranchPurchase } from "@/lib/manso-branch";
import { resolveStorageLocation } from "@/lib/inventory";
import { addAudit, generateBatchNumber, reference } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { purchaseFormulaRules } from "@/lib/purchase-formula";
import { mansoBranchActionSchema } from "@/lib/validation";

const BRANCH_ID = "manso";
const BRANCH_ACCOUNT_NAME = "Manso Branch Funds";
const zero = () => new Prisma.Decimal(0);

async function ensureBranchAccount(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.mansoBranch.findUnique({
    where: { id: BRANCH_ID },
    include: { cashAccount: true },
  });
  if (existing) {
    if (!existing.cashAccount.isActive) throw new HttpError("The Manso Branch Funds account is inactive", 409);
    return existing.cashAccount;
  }

  const existingAccount = await tx.cashAccount.findUnique({ where: { name: BRANCH_ACCOUNT_NAME } });
  if (existingAccount) {
    throw new HttpError(`Rename the existing "${BRANCH_ACCOUNT_NAME}" account before initializing Manso Branch`, 409);
  }
  const cashAccount = await tx.cashAccount.create({
    data: { name: BRANCH_ACCOUNT_NAME, type: "CASH", currency: "GHS", createdById: userId },
  });
  if (cashAccount.type !== "CASH" || cashAccount.currency !== "GHS") {
    throw new HttpError(`The account named "${BRANCH_ACCOUNT_NAME}" must be a GHS cash account`, 409);
  }
  const branch = await tx.mansoBranch.create({
    data: { id: BRANCH_ID, cashAccountId: cashAccount.id },
    include: { cashAccount: true },
  });
  await addAudit(tx, {
    userId,
    action: "manso_branch.account.initialized",
    entity: "MansoBranch",
    entityId: branch.id,
    details: { cashAccountId: cashAccount.id, cashAccountName: cashAccount.name },
  });
  return branch.cashAccount;
}

async function ensureBranchAccountSafely(userId: string) {
  try {
    return await prisma.$transaction((tx) => ensureBranchAccount(tx, userId));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const branch = await prisma.mansoBranch.findUnique({ where: { id: BRANCH_ID }, include: { cashAccount: true } });
      if (branch?.cashAccount.isActive) return branch.cashAccount;
    }
    throw error;
  }
}

async function branchBalance(tx: Prisma.TransactionClient, accountId: string, reservePendingOutflows = false) {
  const movements = await tx.cashMovement.findMany({
    where: { accountId },
    select: { accountId: true, direction: true, amount: true, approvalStatus: true },
  });
  const balance = calculateCashBalances(movements).get(accountId) ?? zero();
  if (!reservePendingOutflows) return balance;
  const pendingOutflows = movements
    .filter((movement) => movement.approvalStatus === "PENDING" && movement.direction === "OUTBOUND")
    .reduce((sum, movement) => sum.plus(movement.amount), zero());
  return balance.minus(pendingOutflows);
}

export async function GET() {
  try {
    const user = await requireUser("payments:read");
    const branchAccount = await ensureBranchAccountSafely(user.id);
    const [movements, accountMovements, pendingOutflows, accounts, formulaConfig] = await Promise.all([
      prisma.cashMovement.findMany({
        where: { accountId: branchAccount.id },
        orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          payment: {
            select: {
              trade: {
                select: {
                  reference: true,
                  totalAmount: true,
                  quantityKg: true,
                  purchaseMeasurement: { select: { topKg: true, downKg: true, density: true, karat: true } },
                },
              },
            },
          },
          createdBy: { select: { name: true } },
        },
      }),
      prisma.cashMovement.findMany({
        where: { accountId: branchAccount.id },
        select: { accountId: true, direction: true, amount: true, approvalStatus: true },
      }),
      prisma.cashMovement.findMany({
        where: { accountId: branchAccount.id, approvalStatus: "PENDING", direction: "OUTBOUND" },
        select: { amount: true },
      }),
      prisma.cashAccount.findMany({
        where: { isActive: true, currency: "GHS", mansoBranch: { is: null } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      }),
      prisma.purchaseFormulaConfig.findUnique({ where: { id: "default" } }),
    ]);
    const balances = calculateCashBalances(accountMovements);
    const pendingAmount = pendingOutflows.reduce((sum, movement) => sum.plus(movement.amount), zero());
    return Response.json({
      account: { id: branchAccount.id, name: branchAccount.name, balance: (balances.get(branchAccount.id) ?? zero()).toFixed(2) },
      availableBalance: (balances.get(branchAccount.id) ?? zero()).minus(pendingAmount).toFixed(2),
      accounts,
      movements,
      formula: purchaseFormulaRules(formulaConfig),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = mansoBranchActionSchema.parse(await readJson(request));
    if (input.action === "RECEIVE_GOLD") {
      if (!can(user.role, "purchases:write", user.permissions) || !can(user.role, "payments:write", user.permissions)) {
        throw new HttpError("You need purchase and payment permissions to receive Manso gold", 403);
      }
    } else if (!can(user.role, "finance:manage", user.permissions)) {
      throw new HttpError("You do not have permission to manage Manso branch funds", 403);
    }

    const branchAccount = await ensureBranchAccountSafely(user.id);
    const result = await prisma.$transaction(async (tx) => {
      if (input.action === "ADVANCE" || input.action === "RETURN") {
        const accountIds = [branchAccount.id, input.cashAccountId].sort();
        await tx.$queryRaw`SELECT id FROM CashAccount WHERE id IN (${Prisma.join(accountIds)}) ORDER BY id FOR UPDATE`;
        const selectedAccount = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
        if (!selectedAccount || !selectedAccount.isActive || selectedAccount.currency !== "GHS") {
          throw new HttpError("Select an active GHS company cash or bank account", 400);
        }
        if (selectedAccount.id === branchAccount.id) throw new HttpError("Select a company account, not the Manso branch account", 400);

        const source = input.action === "ADVANCE" ? selectedAccount : branchAccount;
        const destination = input.action === "ADVANCE" ? branchAccount : selectedAccount;
        const balance = await branchBalance(tx, source.id, source.id === branchAccount.id);
        const amount = new Prisma.Decimal(input.amount);
        if (amount.greaterThan(balance)) {
          throw new HttpError(input.action === "ADVANCE"
            ? "The advance exceeds the available company account balance"
            : "The returned amount exceeds Manso's available funds", 409);
        }
        const group = reference("TRF");
        const movementDate = new Date(input.movementDate);
        const description = input.description.trim();
        const sourceMovement = await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: source.id,
            type: "TRANSFER_OUT",
            direction: "OUTBOUND",
            amount,
            movementDate,
            description,
            transferGroupId: group,
            createdById: user.id,
          },
        });
        await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: destination.id,
            type: "TRANSFER_IN",
            direction: "INBOUND",
            amount,
            movementDate,
            description,
            transferGroupId: group,
            createdById: user.id,
          },
        });
        await addAudit(tx, {
          userId: user.id,
          action: input.action === "ADVANCE" ? "manso_branch.advance.sent" : "manso_branch.cash.returned",
          entity: "CashMovement",
          entityId: sourceMovement.id,
          details: { amount: amount.toString(), from: source.name, to: destination.name, description },
        });
        return { reference: sourceMovement.reference, amount: amount.toFixed(2), action: input.action };
      }

      await tx.$queryRaw`SELECT id FROM CashAccount WHERE id = ${branchAccount.id} FOR UPDATE`;
      const balance = await branchBalance(tx, branchAccount.id, true);

      if (input.action === "EXPENSE") {
        const amount = new Prisma.Decimal(input.amount);
        if (amount.greaterThan(balance)) throw new HttpError("Expense exceeds Manso's available funds", 409);
        const config = await tx.financeConfig.findUnique({ where: { id: "default" } });
        const requiresApproval = Boolean(config?.adjustmentApprovalThreshold
          && amount.greaterThanOrEqualTo(config.adjustmentApprovalThreshold));
        const movement = await tx.cashMovement.create({
          data: {
            reference: reference("FIN"),
            accountId: branchAccount.id,
            type: "ADJUSTMENT_OUT",
            direction: "OUTBOUND",
            amount,
            movementDate: new Date(input.movementDate),
            description: input.description.trim(),
            approvalStatus: requiresApproval ? "PENDING" : "NOT_REQUIRED",
            createdById: user.id,
          },
        });
        await addAudit(tx, {
          userId: user.id,
          action: requiresApproval ? "manso_branch.expense.submitted_for_approval" : "manso_branch.expense.recorded",
          entity: "CashMovement",
          entityId: movement.id,
          details: { reference: movement.reference, amount: amount.toString(), description: movement.description, approvalStatus: movement.approvalStatus },
        });
        return { reference: movement.reference, amount: amount.toFixed(2), action: input.action, approvalStatus: movement.approvalStatus };
      }

      const rules = purchaseFormulaRules(await tx.purchaseFormulaConfig.findUnique({ where: { id: "default" } }));
      if (!rules.ownerConfirmed) {
        throw new HttpError("Gold purchases are disabled until an authorized administrator confirms the saved measurement formulas.", 409);
      }
      const purchase = calculateMansoBranchPurchase(input.topGrams, input.downGrams, input.actualCost, rules);
      if (purchase.actualCost.greaterThan(balance)) {
        throw new HttpError("The gold purchase cost exceeds Manso's available funds", 409);
      }
      const grams = purchase.inventoryGrams;
      const batchNumber = input.batchNumber?.trim() || await generateBatchNumber(tx);
      if (await tx.inventoryLot.findFirst({ where: { batchNumber }, select: { id: true } })) {
        throw new HttpError("That stock batch number is already in use", 409);
      }
      const transactionDate = new Date(input.transactionDate);
      const storageLocation = await resolveStorageLocation(tx, "Main storage", user.id);
      const trade = await tx.trade.create({
        data: {
          reference: reference("PUR"),
          type: "PURCHASE",
          status: "POSTED",
          quantityKg: grams.div(1000),
          purityBps: purchase.purityBps,
          pricePerGram: purchase.pricePerGram,
          totalAmount: purchase.actualCost,
          paymentAmount: purchase.actualCost,
          paymentMethod: "CASH",
          note: ["Manso Branch gold purchase", input.note?.trim()].filter(Boolean).join(" · "),
          transactionDate,
          inventoryBatchNumber: batchNumber,
          createdById: user.id,
        },
      });
      await tx.goldPurchaseMeasurement.create({
        data: {
          tradeId: trade.id,
          topKg: purchase.measurements.topGrams.div(1000).toDecimalPlaces(8),
          downKg: purchase.measurements.downGrams.div(1000).toDecimalPlaces(8),
          pounds: purchase.measurements.pounds.toDecimalPlaces(8),
          density: purchase.measurements.density.toDecimalPlaces(8),
          karat: purchase.measurements.karat.toDecimalPlaces(8),
          formulaVersion: rules.version,
          formulaInputs: {
            topGrams: purchase.measurements.topGrams.toString(),
            downGrams: purchase.measurements.downGrams.toString(),
            actualCost: purchase.actualCost.toFixed(2),
            boardPriceApplied: false,
            inventoryBatchNumber: batchNumber,
            storageLocationName: storageLocation.name,
            transactionDate: input.transactionDate,
          },
          calculationSource: "MANSO_MANUAL_COST",
        },
      });
      const lot = await tx.inventoryLot.create({
        data: {
          tradeId: trade.id,
          batchNumber,
          source: "Manso Branch",
          receivedAt: transactionDate,
          originalGrams: grams,
          remainingGrams: grams,
          costPerGram: purchase.costPerGram,
          purityBps: purchase.purityBps,
          density: purchase.measurements.density.toDecimalPlaces(8),
          pounds: purchase.measurements.pounds.toDecimalPlaces(8),
          storageLocationId: storageLocation.id,
        },
      });
      await tx.stockMovement.create({
        data: {
          reference: reference("MOV"),
          type: "PURCHASE_RECEIPT",
          tradeId: trade.id,
          inventoryLotId: lot.id,
          locationId: storageLocation.id,
          quantityGrams: grams,
          movementDate: transactionDate,
          reason: `Manso Branch gold purchase ${trade.reference}`,
          createdById: user.id,
        },
      });
      const payment = await tx.payment.create({
        data: {
          reference: reference("PAY"),
          direction: "OUTBOUND",
          amount: purchase.actualCost,
          method: "CASH",
          cashAccountId: branchAccount.id,
          note: `Paid from Manso branch funds${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`,
          paidAt: transactionDate,
          tradeId: trade.id,
          createdById: user.id,
        },
      });
      await recordPaymentMovement(tx, {
        paymentId: payment.id,
        cashAccountId: branchAccount.id,
        direction: payment.direction,
        amount: payment.amount,
        movementDate: transactionDate,
        description: `Manso gold purchase ${trade.reference}`,
        createdById: user.id,
      });
      await addAudit(tx, {
        userId: user.id,
        action: "manso_branch.gold.received",
        entity: "Trade",
        entityId: trade.id,
        details: {
          reference: trade.reference,
          batchNumber,
          actualCost: purchase.actualCost.toFixed(2),
          topGrams: purchase.measurements.topGrams.toString(),
          downGrams: purchase.measurements.downGrams.toString(),
          karat: purchase.measurements.karat.toString(),
          boardPriceApplied: false,
        },
      });
      return {
        reference: trade.reference,
        batchNumber,
        amount: purchase.actualCost.toFixed(2),
        action: input.action,
        measurements: {
          topGrams: purchase.measurements.topGrams.toString(),
          downGrams: purchase.measurements.downGrams.toString(),
          pounds: purchase.measurements.pounds.toString(),
          density: purchase.measurements.density.toString(),
          karat: purchase.measurements.karat.toString(),
        },
      };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
