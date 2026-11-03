import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { addAudit } from "@/lib/records";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { customerSchema } from "@/lib/validation";
import { generateUniqueCustomerCode } from "@/lib/customer-code";

export async function GET(request: Request) {
  try {
    const user = await requireUser("customers:read");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const status = searchParams.get("status") ?? "ACTIVE";
    const requestedKind = searchParams.get("kind");
    const kind = requestedKind === "SUPPLIER" ? "SUPPLIER" : requestedKind === "BUYER" ? "BUYER" : null;
    const type = searchParams.get("type");
    const dateRange = searchParams.get("dateRange") ?? "ALL";
    const page = Number(searchParams.get("page") ?? 1);
    const pageSize = Number(searchParams.get("pageSize") ?? 10);
    if (!["ACTIVE", "ARCHIVED", "ALL"].includes(status)) throw new HttpError("Invalid customer status filter", 400);
    if (!kind) throw new HttpError("Select buyer or receiving-stock supplier customers", 400);
    if (type && !["INDIVIDUAL", "BUSINESS"].includes(type)) throw new HttpError("Invalid customer type filter", 400);
    if (!["ALL", "WEEK", "MONTH", "YEAR", "LAST_30_DAYS"].includes(dateRange)) throw new HttpError("Invalid customer date range", 400);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new HttpError("Invalid customer pagination", 400);

    const now = new Date();
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (dateRange === "WEEK") {
      rangeStart.setUTCDate(rangeStart.getUTCDate() - ((rangeStart.getUTCDay() + 6) % 7));
    } else if (dateRange === "MONTH") {
      rangeStart.setUTCDate(1);
    } else if (dateRange === "YEAR") {
      rangeStart.setUTCMonth(0, 1);
    } else if (dateRange === "LAST_30_DAYS") {
      rangeStart.setUTCDate(rangeStart.getUTCDate() - 29);
    }
    const dateFilter = dateRange === "ALL" ? {} : { createdAt: { gte: rangeStart } };

    const where: Prisma.CustomerWhereInput = {
      kind,
      ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
      ...(type ? { type: type as "INDIVIDUAL" | "BUSINESS" } : {}),
      ...dateFilter,
      ...(query ? {
        OR: [
          { name: { contains: query } },
          { code: { contains: query } },
          ...(can(user.role, "customers:personal:read", user.permissions) ? [
            { phone: { contains: query } },
            { alternativePhone: { contains: query } },
            { email: { contains: query } },
          ] : []),
        ],
      } : {}),
    };
    if (searchParams.get("picker") === "true") {
      const canReadPersonal = can(user.role, "customers:personal:read", user.permissions);
      const customers = await prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          code: true,
          kind: true,
          type: true,
          isActive: true,
          ...(canReadPersonal ? { phone: true, address: true } : {}),
        },
      });
      return Response.json({ customers, total: customers.length });
    }
    const canReadTrades = can(user.role, "trades:read", user.permissions);
    const [customers, total, activeCount, archivedCount, purchaseTotals] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.customer.count({ where }),
      prisma.customer.count({ where: { ...dateFilter, kind, isActive: true } }),
      prisma.customer.count({ where: { ...dateFilter, kind, isActive: false } }),
      canReadTrades
        ? prisma.trade.aggregate({
          where: {
            type: kind === "SUPPLIER" ? "PURCHASE" : "SALE",
            status: "POSTED",
            customer: { kind },
            ...(dateRange === "ALL" ? {} : { transactionDate: { gte: rangeStart } }),
          },
          _sum: { quantityKg: true, totalAmount: true },
        })
        : Promise.resolve(null),
    ]);
    const customerTradeTotals = canReadTrades && customers.length
      ? await prisma.trade.groupBy({
        by: ["customerId"],
        where: {
          customerId: { in: customers.map((customer) => customer.id) },
          status: "POSTED",
          ...(dateRange === "ALL" ? {} : { transactionDate: { gte: rangeStart } }),
        },
        _sum: { quantityKg: true, totalAmount: true },
      })
      : [];
    const totalsByCustomer = new Map(customerTradeTotals.map((item) => [item.customerId, {
      quantityKg: Number(item._sum.quantityKg ?? 0),
      totalAmount: Number(item._sum.totalAmount ?? 0),
    }]));
    const safeCustomers = can(user.role, "customers:personal:read", user.permissions)
      ? customers
      : customers.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        kind: customer.kind,
        type: customer.type,
        isActive: customer.isActive,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      }));
    return Response.json({
      customers: safeCustomers.map((customer) => ({
        ...customer,
        ...(canReadTrades ? { transactionTotals: totalsByCustomer.get(customer.id) ?? { quantityKg: 0, totalAmount: 0 } } : {}),
      })),
      total,
      page,
      pageSize,
      summary: {
        total: activeCount + archivedCount,
        active: activeCount,
        archived: archivedCount,
        ...(purchaseTotals ? {
          tradeKg: Number(purchaseTotals._sum.quantityKg ?? 0),
          tradeValue: Number(purchaseTotals._sum.totalAmount ?? 0),
          tradeType: kind === "SUPPLIER" ? "PURCHASE" : "SALE",
        } : {}),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("customers:write");
    const input = customerSchema.parse(await readJson(request));
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          code: await generateUniqueCustomerCode(tx, input.name),
          name: input.name,
          type: input.type,
          kind: input.kind,
          phone: input.phone || null,
          alternativePhone: input.alternativePhone || null,
          email: input.email || null,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
          gender: input.gender || null,
          idType: input.idType || null,
          idNumber: input.idNumber || null,
          tin: input.tin || null,
          address: input.address || null,
          addressLine1: input.addressLine1 || null,
          addressLine2: input.addressLine2 || null,
          city: input.city || null,
          region: input.region || null,
          country: input.country || "Ghana",
          gpsLocation: input.gpsLocation || null,
          notes: input.notes || null,
        },
      });
      await addAudit(tx, { userId: user.id, action: "customer.created", entity: "Customer", entityId: created.id, details: { code: created.code, kind: created.kind } });
      return created;
    });
    return Response.json(customer, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
