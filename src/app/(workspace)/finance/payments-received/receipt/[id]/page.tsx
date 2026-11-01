import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintReceiptButton } from "@/components/print-receipt-button";
import { Button } from "@/components/ui/button";
import { can, getCurrentUser } from "@/lib/authz";
import { formatCurrencyExact } from "@/lib/formatters";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const dateTime = (value: Date) => value.toLocaleString("en-GH", { dateStyle: "long", timeStyle: "short" });

export default async function PaymentReceivedReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "payments:read", user.permissions)) notFound();

  const { id } = await params;
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, code: true } },
      trade: { select: { reference: true, type: true, customer: { select: { name: true, code: true } } } },
      saleCorrection: { select: { reference: true, trade: { select: { reference: true, customer: { select: { name: true, code: true } } } } } },
      cashAccount: { select: { name: true, type: true } },
      customerAdvance: { select: { reference: true, customer: { select: { name: true, code: true } } } },
      buyerFinanceAccount: { select: { reference: true, customer: { select: { name: true, code: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!payment || payment.direction !== "INBOUND") notFound();

  const customer = payment.trade?.customer
    ?? payment.saleCorrection?.trade.customer
    ?? payment.customerAdvance?.customer
    ?? payment.buyerFinanceAccount?.customer
    ?? payment.customer;
  const allocation = payment.trade?.reference
    ?? (payment.saleCorrection ? `Correction ${payment.saleCorrection.reference} · ${payment.saleCorrection.trade.reference}` : null)
    ?? payment.customerAdvance?.reference
    ?? payment.buyerFinanceAccount?.reference
    ?? "Customer payment";

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 print-hide">
      <Button variant="outline" size="sm" asChild><Link href="/finance/payments-received">Back to Payments Received</Link></Button>
      <PrintReceiptButton />
    </div>
    <article className="print-page mx-auto max-w-3xl rounded-xl border border-[#e5e8eb] bg-white p-6 shadow-sm sm:p-10">
      <header className="border-b-2 border-[#bc8c36] pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#9a6a1d]">Big Joe Gold</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#17212f]">Payment Received Receipt</h1>
        <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Payment successfully received</p>
        <div className="mt-4 grid gap-2 text-xs text-[#596574] sm:grid-cols-2">
          <p><strong>Receipt reference:</strong> {payment.reference}</p>
          <p><strong>Date and time:</strong> {dateTime(payment.paidAt)}</p>
          <p><strong>Received from:</strong> {customer?.name ?? "—"}</p>
          <p><strong>Customer code:</strong> {customer?.code ?? "—"}</p>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Payment confirmation</h2>
        <dl className="mt-3 space-y-3 rounded-lg border border-[#e8ebef] p-4 text-xs">
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Amount received</dt><dd className="text-right text-lg font-bold text-[#17212f]">{formatCurrencyExact(payment.amount.toFixed(2))}</dd></div>
          <div className="flex justify-between gap-4 border-t border-[#edf0f3] pt-3"><dt className="text-[#76808c]">Payment method</dt><dd className="text-right font-medium text-[#263241]">{payment.method.replaceAll("_", " ")}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Received into</dt><dd className="text-right font-medium text-[#263241]">{payment.cashAccount?.name ?? "Account not assigned"}{payment.cashAccount ? ` · ${payment.cashAccount.type.replaceAll("_", " ")}` : ""}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#76808c]">Allocated to</dt><dd className="text-right font-medium text-[#263241]">{allocation}</dd></div>
          <div className="flex justify-between gap-4 border-t border-[#edf0f3] pt-3"><dt className="text-[#76808c]">Recorded by</dt><dd className="text-right font-medium text-[#263241]">{payment.createdBy.name}</dd></div>
        </dl>
      </section>

      {payment.note && <section className="mt-5"><h2 className="text-xs font-semibold uppercase tracking-wide text-[#89929d]">Reference or note</h2><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#52606d]">{payment.note}</p></section>}
      <footer className="mt-8 border-t border-[#edf0f3] pt-4 text-center text-[10px] text-[#89929d]">This receipt confirms that the payment above was recorded successfully by Big Joe Gold.</footer>
    </article>
  </div>;
}
