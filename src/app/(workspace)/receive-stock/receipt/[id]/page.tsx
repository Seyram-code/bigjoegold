import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { PrintReceiptButton } from "@/components/print-receipt-button";
import { Button } from "@/components/ui/button";
import { can, getCurrentUser } from "@/lib/authz";
import { formatCurrencyExact, formatPriceAmount, formatTwoDecimalTruncated } from "@/lib/formatters";
import { boardPriceUnitLabel } from "@/lib/board-prices";
import { calculateBuyerFinanceBalance } from "@/lib/buyer-financing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const dateTime = (value: Date) => value.toLocaleString("en-GH", { dateStyle: "long", timeStyle: "short" });

export default async function PurchaseReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "trades:read", user.permissions)) notFound();
  const { id } = await params;
  const trade = await prisma.trade.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, code: true } },
      createdBy: { select: { name: true } },
      boardPrice: { select: { source: true, effectiveAt: true } },
      payments: { select: { amount: true, method: true, paidAt: true } },
      buyerFinanceSettlement: {
        select: {
          reference: true,
          amount: true,
          account: {
            select: {
              customer: { select: { name: true, code: true } },
              payments: { select: { amount: true, direction: true } },
              settlements: { select: { amount: true } },
            },
          },
        },
      },
      purchaseMeasurement: true,
    },
  });
  if (!trade || trade.type !== "PURCHASE" || trade.status !== "POSTED" || !trade.purchaseMeasurement) notFound();
  const cashPaid = trade.payments.reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
  const financed = trade.buyerFinanceSettlement?.amount ?? new Prisma.Decimal(0);
  const paid = cashPaid.plus(financed);
  const outstanding = trade.totalAmount.minus(paid);
  const balance = outstanding.greaterThan(0) ? outstanding : new Prisma.Decimal(0);
  const financingBalance = trade.buyerFinanceSettlement
    ? calculateBuyerFinanceBalance(
      trade.buyerFinanceSettlement.account.payments,
      trade.buyerFinanceSettlement.account.settlements,
    )
    : null;

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 print-hide">
      <Button variant="outline" size="sm" asChild><Link href="/receive-stock">Back to Receive Stock</Link></Button>
      <PrintReceiptButton />
    </div>
    <article className="print-page mx-auto max-w-3xl rounded-xl border border-[#e5e8eb] bg-white p-6 shadow-sm sm:p-10">
      <header className="border-b-2 border-[#bc8c36] pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#9a6a1d]">Big Joe Gold</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#17212f]">Gold Purchase Receipt</h1>
        <div className="mt-4 grid gap-2 text-xs text-[#596574] sm:grid-cols-2">
          <p><strong>Reference:</strong> {trade.reference}</p>
          <p><strong>Transaction date:</strong> {dateTime(trade.transactionDate)}</p>
          <p><strong>Customer:</strong> {trade.customer?.name ?? "—"}</p>
          <p><strong>Customer code:</strong> {trade.customer?.code ?? "—"}</p>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Assay measurements</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#e8ebef] bg-[#e8ebef] sm:grid-cols-3">
          {[
            ["Top weight", `${formatTwoDecimalTruncated(trade.purchaseMeasurement.topKg.mul(1000).toString())} g`],
            ["Down weight", `${formatTwoDecimalTruncated(trade.purchaseMeasurement.downKg.mul(1000).toString())} g`],
            ["Pounds", formatTwoDecimalTruncated(trade.purchaseMeasurement.pounds.toString())],
            ["Density", formatTwoDecimalTruncated(trade.purchaseMeasurement.density.toString())],
            ["Karat", formatTwoDecimalTruncated(trade.purchaseMeasurement.karat.toString())],
            ["Purity", `${formatTwoDecimalTruncated(trade.purchaseMeasurement.karat.div(24).mul(100).toString())}%`],
            ["Calculation version", trade.purchaseMeasurement.formulaVersion],
          ].map(([label, value]) => <div key={label} className="bg-white p-3"><dt className="text-[10px] text-[#89929d]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#263241]">{value}</dd></div>)}
        </dl>
        <p className="mt-2 text-[10px] text-[#89929d]">Assay measurements and purchase value were calculated from the recorded inputs. No manual overrides were applied.</p>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Price and settlement</h2>
        <dl className="mt-3 space-y-2 rounded-lg border border-[#e8ebef] p-4 text-xs">
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Board price</dt><dd className="text-right font-medium text-[#263241]">{formatPriceAmount(trade.pricePerGram.toString(), "GHS")} / {boardPriceUnitLabel(trade.priceUnit)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Price unit</dt><dd className="text-right font-medium text-[#263241]">{boardPriceUnitLabel(trade.priceUnit)}</dd></div>
          {trade.boardPrice && <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Board price source</dt><dd className="text-right font-medium text-[#263241]">{trade.boardPrice.source} · effective {dateTime(trade.boardPrice.effectiveAt)}</dd></div>}
          <div className="flex justify-between gap-4 border-t border-[#edf0f3] pt-2"><dt className="font-semibold text-[#263241]">Actual gold amount</dt><dd className="font-semibold text-[#17212f]">{formatCurrencyExact(trade.totalAmount.toFixed(2))}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Cash paid ({trade.paymentMethod.replaceAll("_", " ")})</dt><dd className="text-right font-medium text-[#263241]">{formatCurrencyExact(cashPaid.toFixed(2))}</dd></div>
          {trade.buyerFinanceSettlement && <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Applied from {trade.buyerFinanceSettlement.account.customer.name}&apos;s financing</dt><dd className="text-right font-medium text-[#263241]">{formatCurrencyExact(financed.toFixed(2))}</dd></div>}
          {financingBalance && <div className="flex justify-between gap-4"><dt className="text-[#76808c]">{financingBalance.greaterThan(0) ? "Customer still owes on financing" : financingBalance.lessThan(0) ? "Big Joe still owes customer on financing" : "Financing balance after this purchase"}</dt><dd className="text-right font-medium text-[#263241]">{formatCurrencyExact(financingBalance.abs().toFixed(2))}</dd></div>}
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Outstanding balance</dt><dd className="text-right font-medium text-[#263241]">{formatCurrencyExact(balance.toFixed(2))}</dd></div>
          <div className="flex justify-between gap-4 border-t border-[#edf0f3] pt-2"><dt className="text-[#76808c]">Recorded by</dt><dd className="text-right font-medium text-[#263241]">{trade.createdBy.name}</dd></div>
        </dl>
      </section>

      {trade.note && <section className="mt-5"><h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Notes</h2><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#52606d]">{trade.note}</p></section>}
      {trade.supportingDocumentRef && <section className="mt-4"><h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Supporting document</h2><p className="mt-2 break-all text-xs text-[#52606d]">{trade.supportingDocumentRef}</p></section>}
      <footer className="mt-8 border-t border-[#edf0f3] pt-4 text-center text-[10px] text-[#89929d]">Thank you for trading with Big Joe Gold. Keep this receipt for your records.</footer>
    </article>
  </div>;
}
