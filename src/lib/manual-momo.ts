export type ManualMomoStatementAccount = {
  openingBalance: number;
  openingDate: string;
  balanceBeforePeriod: number;
};

export type ManualMomoStatementEntry = {
  reference: string;
  direction: "INBOUND" | "OUTBOUND";
  amount: number;
  customerName: string;
  customerPhone: string | null;
  transactionReference: string | null;
  transactionDate: string;
  note: string | null;
};

export type ManualMomoStatementRow = {
  date: string;
  reference: string;
  direction: string;
  customer: string;
  phone: string;
  amount: number;
  balance: number;
  note: string;
};

function cents(value: number) {
  return Math.round(value * 100);
}

export function buildManualMomoStatement(
  account: ManualMomoStatementAccount,
  entries: ManualMomoStatementEntry[],
  from: string,
  to: string,
) {
  const rangeStart = new Date(`${from}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${to}T23:59:59.999Z`).getTime();
  let balance = cents(account.balanceBeforePeriod);
  const rows: ManualMomoStatementRow[] = [];
  const openingDate = new Date(account.openingDate).getTime();
  if (openingDate >= rangeStart && openingDate <= rangeEnd) {
    balance += cents(account.openingBalance);
    rows.push({
      date: account.openingDate,
      reference: "OPENING BALANCE",
      direction: "OPENING BALANCE",
      customer: "—",
      phone: "—",
      amount: account.openingBalance,
      balance: balance / 100,
      note: "Starting balance",
    });
  }
  const opening = balance;
  let received = 0;
  let paid = 0;
  const sortedEntries = [...entries]
    .filter((entry) => {
      const date = new Date(entry.transactionDate).getTime();
      return date >= rangeStart && date <= rangeEnd;
    })
    .sort((left, right) => left.transactionDate.localeCompare(right.transactionDate));
  for (const entry of sortedEntries) {
    const amount = cents(entry.amount);
    if (entry.direction === "INBOUND") {
      received += amount;
      balance += amount;
    } else {
      paid += amount;
      balance -= amount;
    }
    rows.push({
      date: entry.transactionDate,
      reference: entry.transactionReference || entry.reference,
      direction: entry.direction === "INBOUND" ? "RECEIVED" : "PAID",
      customer: entry.customerName,
      phone: entry.customerPhone || "—",
      amount: entry.amount,
      balance: balance / 100,
      note: entry.note || "—",
    });
  }
  return {
    rows,
    opening: opening / 100,
    received: received / 100,
    paid: paid / 100,
    closing: balance / 100,
  };
}
