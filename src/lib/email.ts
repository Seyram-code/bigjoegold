import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { formatCurrencyExact, formatWeight } from "@/lib/formatters";

const REQUEST_TIMEOUT_MS = 10_000;

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

type PurchaseEmail = {
  type: "PURCHASE";
  reference: string;
  counterpartyLabel: "Supplier" | "Buyer";
  counterpartyName: string;
  quantityKg: string | number;
  totalAmount: string | number;
  amountPaid: string | number;
  recordedBy: string;
};

type SaleEmail = {
  type: "SALE";
  reference: string;
  customerName?: string | null;
  quantityKg: string | number;
  totalAmount: string | number;
  amountPaid: string | number;
  recordedBy: string;
};

type SaleCorrectionEmail = {
  type: "SALE_CORRECTION";
  reference: string;
  saleReference: string;
  correctionType: "RETURN" | "REVERSAL";
  customerName?: string | null;
  quantityKg: string | number;
  creditAmount: string | number;
  refundAmount: string | number;
  recordedBy: string;
};

type PaymentEmail = {
  type: "PAYMENT";
  reference: string;
  direction: "INBOUND" | "OUTBOUND";
  amount: string | number;
  method: string;
  customerName?: string | null;
  tradeReference?: string | null;
  recordedBy: string;
};

export type OwnerTransactionEmail = PurchaseEmail | SaleEmail | SaleCorrectionEmail | PaymentEmail;

function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const user = process.env.SMTP_USER?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim() || user;
  const values = [host, user, password, from];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) {
    throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must all be configured.");
  }

  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid port number.");
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (secureValue && secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false.");
  }
  const secure = secureValue ? secureValue === "true" : port === 465;

  return { host, port, secure, user, password, from };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function ownerTransactionEmail(notification: OwnerTransactionEmail) {
  const title = notification.type === "PURCHASE"
    ? "Purchase completed"
    : notification.type === "SALE"
      ? "Sale completed"
      : notification.type === "SALE_CORRECTION"
        ? notification.correctionType === "REVERSAL" ? "Sale reversal completed" : "Sale return completed"
        : "Payment recorded";
  const details = notification.type === "PURCHASE"
    ? [
      [notification.counterpartyLabel, notification.counterpartyName],
      ["Weight", formatWeight(notification.quantityKg)],
      ["Total", formatCurrencyExact(notification.totalAmount)],
      ["Paid", formatCurrencyExact(notification.amountPaid)],
      ["Recorded by", notification.recordedBy],
    ]
    : notification.type === "SALE"
      ? [
        ["Customer", notification.customerName || "Walk-in"],
        ["Weight", formatWeight(notification.quantityKg)],
        ["Total", formatCurrencyExact(notification.totalAmount)],
        ["Paid", formatCurrencyExact(notification.amountPaid)],
        ["Recorded by", notification.recordedBy],
      ]
      : notification.type === "SALE_CORRECTION"
        ? [
          ["Original sale", notification.saleReference],
          ["Customer", notification.customerName || "Walk-in"],
          ["Weight returned", formatWeight(notification.quantityKg)],
          ["Customer credit", formatCurrencyExact(notification.creditAmount)],
          ["Cash refund", formatCurrencyExact(notification.refundAmount)],
          ["Recorded by", notification.recordedBy],
        ]
        : [
        ["Direction", notification.direction === "INBOUND" ? "Money received" : "Money paid"],
        ["Amount", formatCurrencyExact(notification.amount)],
        ["Method", notification.method.replaceAll("_", " ").toLowerCase()],
        ...(notification.tradeReference ? [["Transaction", notification.tradeReference]] : []),
        ...(notification.customerName ? [["Customer", notification.customerName]] : []),
        ["Recorded by", notification.recordedBy],
      ];
  const rows = details.map(([label, value]) => `${label}: ${value}`);
  const htmlRows = details.map(([label, value]) =>
    `<tr><th align="left" style="padding:8px 12px;color:#66717d">${escapeHtml(label)}</th><td style="padding:8px 12px;color:#17212f">${escapeHtml(value)}</td></tr>`,
  ).join("");

  return {
    subject: `Big Joe Gold · ${title} · ${notification.reference}`,
    text: `${title}\nReference: ${notification.reference}\n\n${rows.join("\n")}`,
    html: `<div style="font-family:Arial,sans-serif;color:#17212f"><h2>${escapeHtml(title)}</h2><p>Reference: <strong>${escapeHtml(notification.reference)}</strong></p><table style="border-collapse:collapse">${htmlRows}</table></div>`,
  };
}

function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: REQUEST_TIMEOUT_MS,
    greetingTimeout: REQUEST_TIMEOUT_MS,
    socketTimeout: REQUEST_TIMEOUT_MS,
  });
}

async function deliverMail(
  config: SmtpConfig,
  messages: { to: string; subject: string; text: string; html: string }[],
) {
  const transport = createTransport(config);
  try {
    const results = await Promise.allSettled(messages.map((message) =>
      transport.sendMail({ from: config.from, ...message }),
    ));
    const failures = results.filter((result) => result.status === "rejected");
    for (const failure of failures) {
      if (failure.status === "rejected") console.error("Email delivery failed.", failure.reason);
    }
    return failures.length === 0;
  } finally {
    transport.close();
  }
}

export async function sendOwnerTransactionEmail(notification: OwnerTransactionEmail) {
  try {
    const config = smtpConfig();
    if (!config) {
      console.warn("Owner transaction email was not sent because SMTP is not configured.");
      return false;
    }
    const owners = await prisma.user.findMany({
      where: { role: "OWNER", isActive: true },
      select: { email: true },
    });
    if (owners.length === 0) {
      console.warn("Owner transaction email was not sent because no active owner accounts were found.");
      return false;
    }
    const message = ownerTransactionEmail(notification);
    return await deliverMail(config, owners.map(({ email }) => ({ to: email, ...message })));
  } catch (error) {
    console.error("Transaction was saved, but its owner email notification could not be sent.", error);
    return false;
  }
}

export async function sendOwnerPasswordResetEmail(input: { email: string; name: string; url: string }) {
  try {
    const config = smtpConfig();
    if (!config) throw new Error("SMTP is not configured.");
    const safeName = escapeHtml(input.name);
    const safeUrl = escapeHtml(input.url);
    const delivered = await deliverMail(config, [{
      to: input.email,
      subject: "Reset your Big Joe Gold password",
      text: `Hello ${input.name},\n\nUse the link below to reset your Big Joe Gold password. This link expires in one hour and can only be used once.\n\n${input.url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;color:#17212f"><h2>Reset your password</h2><p>Hello ${safeName},</p><p>Use this link to reset your Big Joe Gold password. It expires in one hour and can only be used once.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#292313;color:#ffd344;text-decoration:none;border-radius:8px">Reset password</a></p><p>If you did not request this, you can ignore this email.</p></div>`,
    }]);
    if (!delivered) throw new Error("SMTP did not accept the owner password reset email.");
  } catch (error) {
    console.error("Owner password reset email could not be sent.", error);
  }
}
