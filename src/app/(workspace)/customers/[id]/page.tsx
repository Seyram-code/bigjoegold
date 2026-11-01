import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, can } from "@/lib/authz";
import { formatCurrency, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "customers:read", user.permissions)) notFound();
  const { id } = await params;
  const [customer, payments] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        trades: {
          where: { status: "POSTED" },
          orderBy: { transactionDate: "desc" },
          include: {
            payments: { select: { amount: true, direction: true } },
            advanceFulfillment: { select: { amount: true } },
            buyerFinanceSettlement: { select: { amount: true } },
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: { customerId: id },
      orderBy: { paidAt: "desc" },
      include: { trade: { select: { reference: true, type: true } } },
    }),
  ]);
  if (!customer) notFound();

  const mayViewPersonal = can(user.role, "customers:personal:read", user.permissions);
  const purchases = customer.trades.filter((trade) => trade.type === "PURCHASE");
  const sales = customer.trades.filter((trade) => trade.type === "SALE");
  const purchaseWeight = purchases.reduce((sum, trade) => sum + Number(trade.quantityKg), 0);
  const purchaseValue = purchases.reduce((sum, trade) => sum + Number(trade.totalAmount), 0);
  const salesValue = sales.reduce((sum, trade) => sum + Number(trade.totalAmount), 0);
  const purchaseBalance = purchases.reduce((sum, trade) => sum + Number(trade.totalAmount)
    - trade.payments.reduce((paid, payment) => paid + Number(payment.amount), 0)
    - Number(trade.buyerFinanceSettlement?.amount ?? 0), 0);
  const salesBalance = sales.reduce((sum, trade) => sum + Number(trade.totalAmount)
    - trade.payments.reduce((paid, payment) => paid + Number(payment.amount), 0)
    - Number(trade.advanceFulfillment?.amount ?? 0), 0);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Button asChild variant="outline" size="sm"><Link href={customer.kind === "SUPPLIER" ? "/receiving-suppliers" : "/customers"}><ArrowLeft size={14} /> {customer.kind === "SUPPLIER" ? "Receiving Stock Suppliers" : "Sales Customers"}</Link></Button><Badge tone={customer.isActive ? "green" : "neutral"}>{customer.isActive ? "Active" : "Archived"}</Badge></div>
      {can(user.role, "customers:export", user.permissions) && <a href={`/api/customers/export?kind=${customer.kind}&status=ALL&q=${encodeURIComponent(customer.code)}`} className="text-xs font-semibold text-[#a4772c] hover:underline">Export customer report</a>}
    </div>
    <div className="flex items-start gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#f5e3b0] text-[#795719]"><UserRound size={22} /></span>
      <div className="min-w-0"><p className="font-mono text-xs text-[#89929d]">{customer.code}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#17212f]">{customer.name}</h1><p className="mt-1 text-sm text-[#76808c]">{customer.kind === "SUPPLIER" ? "Receiving-stock supplier" : "Sales customer"} · {customer.type === "BUSINESS" ? "Business" : "Individual"} · Added {customer.createdAt.toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" })}</p></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Gold purchased from customer" value={formatWeight(purchaseWeight)} />
      <Metric label="Purchase value" value={formatCurrency(purchaseValue)} />
      <Metric label="Sales value" value={formatCurrency(salesValue)} />
      <Metric label="Total transactions" value={customer.trades.length.toLocaleString()} />
    </div>

    <div className="grid gap-5 xl:grid-cols-[1fr_1.5fr]">
      <Card>
        <CardHeader><CardTitle>Customer details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Detail label="Phone" value={mayViewPersonal ? customer.phone : null} protectedValue={!mayViewPersonal} />
          <Detail label="Alternative phone" value={mayViewPersonal ? customer.alternativePhone : null} protectedValue={!mayViewPersonal} />
          <Detail label="Email" value={mayViewPersonal ? customer.email : null} protectedValue={!mayViewPersonal} />
          <Detail label="Address" value={mayViewPersonal ? customer.address : null} protectedValue={!mayViewPersonal} />
          <Detail label="Date of birth" value={mayViewPersonal && customer.dateOfBirth ? customer.dateOfBirth.toLocaleDateString("en-GH") : null} protectedValue={!mayViewPersonal} />
          <Detail label="Gender" value={mayViewPersonal ? customer.gender?.replaceAll("_", " ") ?? null : null} protectedValue={!mayViewPersonal} />
          <Detail label="ID type" value={mayViewPersonal ? customer.idType?.replaceAll("_", " ") ?? null : null} protectedValue={!mayViewPersonal} />
          <Detail label="ID number" value={mayViewPersonal ? customer.idNumber : null} protectedValue={!mayViewPersonal} />
          <Detail label="Address line 1" value={mayViewPersonal ? customer.addressLine1 : null} protectedValue={!mayViewPersonal} />
          <Detail label="Address line 2" value={mayViewPersonal ? customer.addressLine2 : null} protectedValue={!mayViewPersonal} />
          <Detail label="City / town" value={mayViewPersonal ? customer.city : null} protectedValue={!mayViewPersonal} />
          <Detail label="Region" value={mayViewPersonal ? customer.region : null} protectedValue={!mayViewPersonal} />
          <Detail label="Country" value={mayViewPersonal ? customer.country : null} protectedValue={!mayViewPersonal} />
          <Detail label="GPS location" value={mayViewPersonal ? customer.gpsLocation : null} protectedValue={!mayViewPersonal} />
          <Detail label="Identification reference" value={mayViewPersonal ? customer.tin : null} protectedValue={!mayViewPersonal} />
          <Detail label="Notes" value={mayViewPersonal ? customer.notes : null} protectedValue={!mayViewPersonal} />
          {!mayViewPersonal && <p className="rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">Contact details and other personal information are restricted for your role.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Outstanding balances</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Balance label="Owed to customer for purchases" amount={purchaseBalance} icon="out" />
          <Balance label="Owed by customer for sales" amount={salesBalance} icon="in" />
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle>Purchase and sales history</CardTitle><p className="text-[11px] text-[#89929d]">Posted gold trades associated with this customer.</p></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><thead><tr className="border-y border-[#edf0f3] text-[10px] font-semibold uppercase tracking-wide text-[#929ba6]"><th className="py-3 pr-3">Reference</th><th className="py-3 pr-3">Type</th><th className="py-3 pr-3">Weight</th><th className="py-3 pr-3">Purity</th><th className="py-3 pr-3">Amount</th><th className="py-3">Date</th></tr></thead><tbody>
        {customer.trades.length ? customer.trades.map((trade) => <tr key={trade.id} className="border-b border-[#f0f2f4] last:border-0"><td className="py-3.5 pr-3 text-xs font-semibold text-[#293442]">{trade.reference}</td><td className="py-3.5 pr-3"><Badge tone={trade.type === "PURCHASE" ? "blue" : "green"}>{trade.type}</Badge></td><td className="py-3.5 pr-3 text-xs text-[#63707e]">{formatWeight(Number(trade.quantityKg))}</td><td className="py-3.5 pr-3 text-xs text-[#63707e]">{formatDecimalTruncated(trade.purityBps / 100, 2)}%</td><td className="py-3.5 pr-3 text-xs font-semibold text-[#293442]">{formatCurrency(Number(trade.totalAmount))}</td><td className="py-3.5 text-xs text-[#8b949e]">{trade.transactionDate.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</td></tr>) : <tr><td colSpan={6} className="py-10 text-center text-xs text-[#929ba6]">No purchases or sales have been recorded for this customer.</td></tr>}
      </tbody></table></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Payment history</CardTitle><p className="text-[11px] text-[#89929d]">Latest recorded payments for this customer.</p></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead><tr className="border-y border-[#edf0f3] text-[10px] font-semibold uppercase tracking-wide text-[#929ba6]"><th className="py-3 pr-3">Reference</th><th className="py-3 pr-3">Direction</th><th className="py-3 pr-3">Related trade</th><th className="py-3 pr-3">Method</th><th className="py-3 pr-3">Amount</th><th className="py-3">Date</th></tr></thead><tbody>
        {payments.length ? payments.map((payment) => <tr key={payment.id} className="border-b border-[#f0f2f4] last:border-0"><td className="py-3.5 pr-3 text-xs font-semibold text-[#293442]">{payment.reference}</td><td className="py-3.5 pr-3"><Badge tone={payment.direction === "INBOUND" ? "green" : "blue"}>{payment.direction === "INBOUND" ? "Received" : "Paid"}</Badge></td><td className="py-3.5 pr-3 text-xs text-[#63707e]">{payment.trade?.reference ?? "—"}</td><td className="py-3.5 pr-3 text-xs text-[#63707e]">{payment.method.replaceAll("_", " ")}</td><td className="py-3.5 pr-3 text-xs font-semibold text-[#293442]">{formatCurrency(Number(payment.amount))}</td><td className="py-3.5 text-xs text-[#8b949e]">{payment.paidAt.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</td></tr>) : <tr><td colSpan={6} className="py-10 text-center text-xs text-[#929ba6]">No payments recorded for this customer yet.</td></tr>}
      </tbody></table></CardContent>
    </Card>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-[10px] font-medium text-[#85909b]">{label}</p><p className="mt-2 text-lg font-semibold tracking-tight text-[#17212f]">{value}</p></CardContent></Card>;
}

function Detail({ label, value, protectedValue = false }: { label: string; value: string | null; protectedValue?: boolean }) {
  return <div><p className="text-[10px] font-medium uppercase tracking-wide text-[#929ba6]">{label}</p><p className="mt-1 break-words text-xs text-[#354252]">{protectedValue ? "Restricted" : value || "—"}</p></div>;
}

function Balance({ label, amount, icon }: { label: string; amount: number; icon: "in" | "out" }) {
  const Icon = icon === "in" ? ArrowDownLeft : ArrowUpRight;
  return <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f8f9fa] p-3"><span className="flex items-center gap-2 text-xs text-[#687482]"><Icon size={15} />{label}</span><span className="text-sm font-semibold text-[#293442]">{formatCurrency(Math.max(0, amount))}</span></div>;
}
