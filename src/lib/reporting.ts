export type ReportGrouping = "day" | "week" | "month";
export type TradeReportPoint = {
  transactionDate: string;
  type: string;
  quantityKg: number;
  netAmount: number;
};

export type DailyBuyerFinancingAccount = {
  customerId: string;
  customer: string;
  payments: Array<{ amount: number; direction: "INBOUND" | "OUTBOUND"; paidAt: string }>;
  settlements: Array<{ amount: number; createdAt: string; quantityKg: number }>;
};

export type DailySupplierPurchase = {
  transactionDate: string;
  quantityKg: number;
  totalAmount: number;
  payments: Array<{ amount: number; direction: "INBOUND" | "OUTBOUND"; paidAt: string }>;
  settlements: Array<{ amount: number; createdAt: string }>;
};

export type DailyBuyerFinancingSummary = {
  date: string;
  customer: string;
  stockKg: number;
  financing: number;
  balance: number;
};

export type DailySupplierPurchaseSummary = {
  date: string;
  stockKg: number;
  sales: number;
  balance: number;
};

function amountInPesewas(value: string | number) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) throw new RangeError("Profit amounts must be valid GHS values");
  const [, sign, whole, fraction = ""] = match;
  const cents = BigInt(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  const roundedCents = fraction[2] && fraction[2] >= "5" ? cents + BigInt(1) : cents;
  return sign ? -roundedCents : roundedCents;
}

function ratio(numerator: bigint, denominator: bigint) {
  const scale = BigInt(1_000_000_000);
  return Number((numerator * scale) / denominator) / Number(scale);
}

export function calculateProfitMetrics(salesValue: string | number, costOfSales: string | number) {
  const salesPesewas = amountInPesewas(salesValue);
  const costPesewas = amountInPesewas(costOfSales);
  const profitPesewas = salesPesewas - costPesewas;
  return {
    profit: Number(profitPesewas) / 100,
    grossMargin: salesPesewas > BigInt(0) ? ratio(profitPesewas, salesPesewas) : null,
    returnOnCost: costPesewas > BigInt(0) ? ratio(profitPesewas, costPesewas) : null,
  };
}

function dateOnly(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function isWithinRange(date: string, from: string, to: string) {
  const day = dateOnly(date);
  return day >= from && day <= to;
}

function toPesewas(value: number) {
  return Math.round(value * 100);
}

export function buildDailyBuyerFinancingSummary(
  accounts: DailyBuyerFinancingAccount[],
  from: string,
  to: string,
): DailyBuyerFinancingSummary[] {
  const events = accounts.flatMap((account) => [
    ...account.payments.map((payment) => ({
      customerId: account.customerId,
      customer: account.customer,
      date: dateOnly(payment.paidAt),
      stockKg: 0,
      financingPesewas: payment.direction === "OUTBOUND" ? toPesewas(payment.amount) : 0,
      balanceChangePesewas: payment.direction === "OUTBOUND" ? toPesewas(payment.amount) : -toPesewas(payment.amount),
    })),
    ...account.settlements.map((settlement) => ({
      customerId: account.customerId,
      customer: account.customer,
      date: dateOnly(settlement.createdAt),
      stockKg: settlement.quantityKg,
      financingPesewas: 0,
      balanceChangePesewas: -toPesewas(settlement.amount),
    })),
  ]).filter((event) => event.date <= to)
    .sort((left, right) => left.date.localeCompare(right.date) || left.customerId.localeCompare(right.customerId));

  const balances = new Map<string, number>();
  const daily = new Map<string, DailyBuyerFinancingSummary & { customerId: string; financingPesewas: number; balancePesewas: number }>();
  for (const event of events) {
    const balance = (balances.get(event.customerId) ?? 0) + event.balanceChangePesewas;
    balances.set(event.customerId, balance);
    if (!isWithinRange(event.date, from, to)) continue;
    const key = `${event.date}:${event.customerId}`;
    const row = daily.get(key) ?? {
      date: event.date,
      customerId: event.customerId,
      customer: event.customer,
      stockKg: 0,
      financing: 0,
      financingPesewas: 0,
      balance: 0,
      balancePesewas: 0,
    };
    row.stockKg += event.stockKg;
    row.financingPesewas += event.financingPesewas;
    row.balancePesewas = balance;
    daily.set(key, row);
  }
  return [...daily.values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.customer.localeCompare(right.customer))
    .map((row) => ({
      date: row.date,
      customer: row.customer,
      stockKg: row.stockKg,
      financing: row.financingPesewas / 100,
      balance: row.balancePesewas / 100,
    }));
}

export function buildDailySupplierPurchaseSummary(
  trades: DailySupplierPurchase[],
  from: string,
  to: string,
): DailySupplierPurchaseSummary[] {
  const daily = new Map<string, { stockKg: number; salesPesewas: number; balanceChangePesewas: number }>();
  const addEvent = (date: string, values: { stockKg?: number; salesPesewas?: number; balanceChangePesewas: number }) => {
    if (date > to) return;
    const row = daily.get(date) ?? { stockKg: 0, salesPesewas: 0, balanceChangePesewas: 0 };
    row.stockKg += values.stockKg ?? 0;
    row.salesPesewas += values.salesPesewas ?? 0;
    row.balanceChangePesewas += values.balanceChangePesewas;
    daily.set(date, row);
  };

  for (const trade of trades) {
    const purchaseDate = dateOnly(trade.transactionDate);
    const events = [
      { date: purchaseDate, kind: "PURCHASE" as const, amount: toPesewas(trade.totalAmount) },
      ...trade.payments.filter((payment) => payment.direction === "OUTBOUND").map((payment) => ({
        date: dateOnly(payment.paidAt),
        kind: "PAYMENT" as const,
        amount: toPesewas(payment.amount),
      })),
      ...trade.settlements.map((settlement) => ({
        date: dateOnly(settlement.createdAt),
        kind: "PAYMENT" as const,
        amount: toPesewas(settlement.amount),
      })),
    ].sort((left, right) => left.date.localeCompare(right.date)
      || (left.kind === right.kind ? 0 : left.kind === "PURCHASE" ? -1 : 1));
    let purchased = false;
    let paidPesewas = 0;
    let previousBalance = 0;
    for (const event of events) {
      if (event.kind === "PURCHASE") purchased = true;
      else paidPesewas += event.amount;
      const currentBalance = purchased ? Math.max(0, toPesewas(trade.totalAmount) - paidPesewas) : 0;
      addEvent(event.date, {
        stockKg: event.kind === "PURCHASE" ? trade.quantityKg : 0,
        salesPesewas: event.kind === "PURCHASE" ? toPesewas(trade.totalAmount) : 0,
        balanceChangePesewas: currentBalance - previousBalance,
      });
      previousBalance = currentBalance;
    }
  }

  let balancePesewas = 0;
  return [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => {
      balancePesewas += row.balanceChangePesewas;
      return { date, stockKg: row.stockKg, sales: row.salesPesewas / 100, balance: balancePesewas / 100 };
    })
    .filter((row) => row.date >= from && row.date <= to);
}

function dateBucket(value: string, grouping: ReportGrouping) {
  const day = new Date(value);
  if (grouping === "month") return day.toISOString().slice(0, 7);
  if (grouping === "week") {
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return `Week of ${day.toISOString().slice(0, 10)}`;
  }
  return day.toISOString().slice(0, 10);
}

export function groupTradeTotals(trades: TradeReportPoint[], grouping: ReportGrouping) {
  const grouped = new Map<string, {
    period: string;
    purchasesKg: number;
    purchaseValue: number;
    salesKg: number;
    salesValue: number;
  }>();
  for (const trade of trades) {
    const period = dateBucket(trade.transactionDate, grouping);
    const current = grouped.get(period) ?? { period, purchasesKg: 0, purchaseValue: 0, salesKg: 0, salesValue: 0 };
    if (trade.type === "PURCHASE") {
      current.purchasesKg += trade.quantityKg;
      current.purchaseValue += trade.netAmount;
    } else if (trade.type === "SALE") {
      current.salesKg += trade.quantityKg;
      current.salesValue += trade.netAmount;
    }
    grouped.set(period, current);
  }
  return [...grouped.values()];
}
