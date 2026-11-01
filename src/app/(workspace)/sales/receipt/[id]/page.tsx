import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { PrintReceiptButton } from "@/components/print-receipt-button";
import { Button } from "@/components/ui/button";
import { can, getCurrentUser } from "@/lib/authz";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { formatCurrencyExact } from "@/lib/formatters";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const dateTime = (value: Date) => value.toLocaleString("en-GH", { dateStyle: "long", timeStyle: "short" });
const money = (value: Prisma.Decimal) => formatCurrencyExact(value.toFixed(2));
const grams = (value: Prisma.Decimal) => `${formatDecimalTruncated(value.toString(), 2)} g`;
const goldWeight = (kilograms: Prisma.Decimal) => kilograms.abs().greaterThanOrEqualTo(1)
  ? `${formatDecimalTruncated(kilograms.toString(), 2)} kg`
  : grams(kilograms.mul(1000));

export default async function SaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "trades:read", user.permissions)) notFound();
  const { id } = await params;
  const sale = await prisma.trade.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, code: true } },
      createdBy: { select: { name: true } },
      allocations: {
        include: { lot: { select: { batchNumber: true, trade: { select: { reference: true } } } } },
        orderBy: { createdAt: "asc" },
      },
      payments: { orderBy: { paidAt: "asc" } },
      advanceFulfillment: { select: { amount: true } },
      saleMeasurement: true,
      corrections: {
        include: {
          allocations: {
            include: { lot: { select: { batchNumber: true, trade: { select: { reference: true } } } } },
          },
          createdBy: { select: { name: true } },
          payments: { orderBy: { paidAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!sale || sale.type !== "SALE") notFound();

  const paid = sale.payments.filter((payment) => payment.direction === "INBOUND").reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const refund = sale.corrections.reduce((sum, correction) => sum.plus(correction.refundAmount), new Prisma.Decimal(0));
  const credit = sale.corrections.reduce((sum, correction) => sum.plus(correction.creditAmount), new Prisma.Decimal(0));
  const advanceCreditApplied = sale.advanceFulfillment?.amount ?? new Prisma.Decimal(0);
  const balance = Prisma.Decimal.max(new Prisma.Decimal(sale.totalAmount).minus(credit).minus(paid).minus(advanceCreditApplied).plus(refund), 0);
  const subtotal = sale.totalAmount.plus(sale.discountAmount);
  const returnedGrams = sale.corrections.reduce((sum, correction) => sum.plus(correction.quantityGrams), new Prisma.Decimal(0));
  const status = sale.status === "VOIDED" ? "REVERSED" : sale.status === "RETURNED" ? "RETURNED" : returnedGrams.greaterThan(0) ? "PARTIALLY RETURNED" : "POSTED";

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 print-hide">
      <Button variant="outline" size="sm" asChild><Link href="/sales/history">Back to Sales History</Link></Button>
      <PrintReceiptButton />
    </div>
    <article className="print-page mx-auto max-w-3xl rounded-xl border border-[#e5e8eb] bg-white p-6 shadow-sm sm:p-10">
      <header className="border-b-2 border-[#bc8c36] pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#9a6a1d]">Big Joe Gold</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#17212f]">Gold Sales Receipt</h1>
        <div className="mt-4 grid gap-2 text-xs text-[#596574] sm:grid-cols-2">
          <p><strong>Reference:</strong> {sale.reference}</p>
          <p><strong>Status:</strong> {status}</p>
          <p><strong>Sale date:</strong> {dateTime(sale.transactionDate)}</p>
          <p><strong>Buyer:</strong> {sale.customer?.name ?? "Walk-in"}</p>
          {sale.customer && <p><strong>Buyer code:</strong> {sale.customer.code}</p>}
          <p><strong>Completed by:</strong> {sale.createdBy.name}</p>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Sale details</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#e8ebef] bg-[#e8ebef] sm:grid-cols-3">
          {[
            ["Gold sold", goldWeight(sale.quantityKg)],
            ["Purity", `${formatDecimalTruncated(sale.purityBps / 100, 2)}%`],
            ["Price basis", sale.priceUnit],
            ["Rate per pure gram", `${money(sale.pricePerGram)}`],
            ["Subtotal", money(subtotal)],
            ["Discount", money(sale.discountAmount)],
            ["Sale total", money(sale.totalAmount)],
            ["Amount credited", money(credit)],
            ["Balance due", money(balance)],
          ].map(([label, value]) => <div key={label} className="bg-white p-3"><dt className="text-[10px] text-[#89929d]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#263241]">{value}</dd></div>)}
        </dl>
        {sale.discountAmount.greaterThan(0) && <p className="mt-2 text-[10px] text-[#89929d]">Discount was applied by an authorized staff member and captured in the audit log.</p>}
      </section>

      {sale.saleMeasurement && <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Gold measurement</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#e8ebef] bg-[#e8ebef] sm:grid-cols-3">
          {[
            ["Top weight", grams(sale.saleMeasurement.topGrams)],
            ["Down weight", grams(sale.saleMeasurement.downGrams)],
            ["Pounds", `${formatDecimalTruncated(sale.saleMeasurement.pounds.toString(), 2)} lb`],
            ["Density", formatDecimalTruncated(sale.saleMeasurement.density.toString(), 2)],
            ["Karat", `${formatDecimalTruncated(sale.saleMeasurement.karat.toString(), 2)}K`],
            ["Formula version", sale.saleMeasurement.formulaVersion],
          ].map(([label, value]) => <div key={label} className="bg-white p-3"><dt className="text-[10px] text-[#89929d]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#263241]">{value}</dd></div>)}
        </dl>
        <p className="mt-2 text-[10px] text-[#89929d]">Sale value was calculated from the recorded measurements and selling board price using the saved formula version.</p>
      </section>}

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Stock batches issued</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#e8ebef]"><table className="w-full min-w-[420px] text-left text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase text-[#89929d]"><tr><th className="p-3">Batch reference</th><th className="p-3">Weight sold</th><th className="p-3">Cost basis</th></tr></thead><tbody>{sale.allocations.map((allocation) => <tr key={allocation.id} className="border-t border-[#edf0f3]"><td className="p-3">{allocation.lot.batchNumber || allocation.lot.trade?.reference || "—"}</td><td className="p-3">{grams(allocation.grams)}</td><td className="p-3">{money(allocation.costAmount)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Payments</h2>
        <div className="mt-3 space-y-2 rounded-lg border border-[#e8ebef] p-4 text-xs">
          {sale.payments.map((payment) => <div key={payment.id} className="flex justify-between gap-4"><span>{payment.reference} · {payment.direction} · {payment.method.replaceAll("_", " ")} · {dateTime(payment.paidAt)}</span><strong>{money(payment.amount)}</strong></div>)}
          {advanceCreditApplied.greaterThan(0) && <div className="flex justify-between gap-4"><span>Customer advance credit applied</span><strong>{money(advanceCreditApplied)}</strong></div>}
          {sale.corrections.flatMap((correction) => correction.payments.map((payment) => <div key={payment.id} className="flex justify-between gap-4 text-rose-700"><span>{payment.reference} · Refund · {payment.method.replaceAll("_", " ")} · {dateTime(payment.paidAt)}</span><strong>{money(payment.amount)}</strong></div>))}
          {!sale.payments.length && sale.corrections.every((correction) => correction.payments.length === 0) && <p className="text-[#89929d]">No payments recorded.</p>}
          <div className="flex justify-between border-t border-[#edf0f3] pt-2"><span>Net cash received</span><strong>{money(paid.minus(refund))}</strong></div>
        </div>
      </section>

      {sale.corrections.length > 0 && <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Audited returns and reversals</h2>
        <div className="mt-3 space-y-3">{sale.corrections.map((correction) => <div key={correction.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><strong>{correction.reference} · {correction.type}</strong><span>{dateTime(correction.createdAt)} · {correction.createdBy.name}</span></div>
          <p className="mt-2">{correction.reason}</p>
          <p className="mt-1">Weight: {grams(correction.quantityGrams)} · Credit: {money(correction.creditAmount)} · Refund: {money(correction.refundAmount)}</p>
          {correction.allocations.map((allocation) => <p key={allocation.id} className="mt-1 text-[#687380]">Returned {grams(allocation.grams)} to batch {allocation.lot.batchNumber || allocation.lot.trade?.reference || "—"}</p>)}
        </div>)}</div>
      </section>}
      {sale.note && <section className="mt-5"><h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Notes</h2><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#52606d]">{sale.note}</p></section>}
      <footer className="mt-8 border-t border-[#edf0f3] pt-4 text-center text-[10px] text-[#89929d]">Thank you for trading with Big Joe Gold. Keep this receipt for your records.</footer>
    </article>
  </div>;
}
