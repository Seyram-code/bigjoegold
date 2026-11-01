import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/authz";
import { customerCsvRow } from "@/lib/customer-csv";
import { apiError, HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireUser("trades:read");
    const search = new URL(request.url).searchParams;
    const query = search.get("q")?.trim() ?? "";
    const status = search.get("status") ?? "ALL";
    const fromValue = search.get("from");
    const toValue = search.get("to");
    if (!["ALL", "POSTED", "PARTIALLY_RETURNED", "RETURNED", "VOIDED"].includes(status)) throw new HttpError("Invalid sale status filter", 400);
    const from = fromValue ? new Date(fromValue) : null;
    const to = toValue ? new Date(toValue) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) {
      throw new HttpError("Provide a valid sale date range", 400);
    }
    const where: Prisma.TradeWhereInput = {
      type: "SALE" as const,
      ...(status === "ALL" ? { status: { in: ["POSTED", "RETURNED", "VOIDED"] } }
        : status === "PARTIALLY_RETURNED" ? { status: "POSTED" as const, corrections: { some: {} } }
          : status === "POSTED" ? { status: "POSTED" as const, corrections: { none: {} } }
            : { status: status as "RETURNED" | "VOIDED" }),
      ...(from || to ? { transactionDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query ? {
        OR: [
          { reference: { contains: query } },
          { customer: { name: { contains: query } } },
          { customer: { code: { contains: query } } },
        ],
      } : {}),
    };
    const count = await prisma.trade.count({ where });
    if (count > 10000) throw new HttpError("Narrow the search or date range to export 10,000 sales or fewer", 413);
    const sales = await prisma.trade.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      include: {
        customer: { select: { name: true, code: true } },
        createdBy: { select: { name: true } },
        payments: { where: { direction: "INBOUND" }, select: { amount: true } },
        advanceFulfillment: { select: { amount: true } },
        corrections: { select: { quantityGrams: true, creditAmount: true, refundAmount: true } },
      },
    });
    const header = ["Reference", "Status", "Buyer", "Buyer code", "Sale date", "Weight kg", "Purity bps", "Rate per pure gram GHS", "Subtotal GHS", "Discount GHS", "Sale total GHS", "Returned kg", "Credit GHS", "Paid GHS", "Refunded GHS", "Balance due GHS", "Recorded by"];
    const lines = sales.map((sale) => {
      const credit = sale.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), new Prisma.Decimal(0));
      const returned = sale.corrections.reduce((sum, correction) => sum.plus(correction.quantityGrams), new Prisma.Decimal(0));
      const refund = sale.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), new Prisma.Decimal(0));
      const paid = sale.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))
        .plus(sale.advanceFulfillment?.amount ?? 0);
      const balance = Prisma.Decimal.max(new Prisma.Decimal(sale.totalAmount).minus(credit).minus(paid).plus(refund), 0);
      const saleStatus = sale.status === "VOIDED" ? "VOIDED" : sale.status === "RETURNED" ? "RETURNED" : returned.greaterThan(0) ? "PARTIALLY_RETURNED" : "POSTED";
      const subtotal = new Prisma.Decimal(sale.totalAmount).plus(sale.discountAmount);
      return [
        sale.reference, saleStatus, sale.customer?.name ?? "Walk-in", sale.customer?.code ?? "",
        sale.transactionDate.toISOString(), sale.quantityKg.toString(), sale.purityBps,
        sale.pricePerGram.toString(), subtotal.toFixed(2), sale.discountAmount.toFixed(2),
        sale.totalAmount.toFixed(2), returned.div(1000).toString(), credit.toFixed(2),
        paid.toFixed(2), refund.toFixed(2), balance.toFixed(2), sale.createdBy.name,
      ];
    });
    const content = [customerCsvRow(header), ...lines.map(customerCsvRow)].join("\r\n");
    return new Response(`\uFEFF${content}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="big-joe-gold-sales-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
