export type ReportGrouping = "day" | "week" | "month";
export type TradeReportPoint = {
  transactionDate: string;
  type: string;
  quantityKg: number;
  netAmount: number;
};

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
