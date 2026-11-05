import { formatCurrencyExact, formatWeight } from "@/lib/formatters";
import { prisma } from "@/lib/prisma";

const FROG_SEND_URL = "https://frogapi.wigal.com.gh/api/v3/sms/send";
const REQUEST_TIMEOUT_MS = 10_000;

type FrogConfig = { apiKey: string; username: string; senderId: string; ownerPhones: string[] };
type PurchaseSms = { reference: string; supplierName: string; quantityKg: string | number; totalAmount: string | number; amountPaid: string | number; recordedBy: string };
type SaleSms = { reference: string; customerName?: string | null; quantityKg: string | number; totalAmount: string | number; amountPaid: string | number; recordedBy: string };
type PaymentSms = { reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; method: string; customerName?: string | null; tradeReference?: string | null; recordedBy: string };

function required(value: string | undefined) { return value?.trim() ?? ""; }

function frogConfig(): FrogConfig | null {
  const apiKey = required(process.env.WIGAL_FROG_API_KEY);
  const username = required(process.env.WIGAL_FROG_USERNAME);
  const senderId = required(process.env.WIGAL_FROG_SENDER_ID);
  const ownerPhones = [...new Set(required(process.env.WIGAL_FROG_OWNER_PHONE).split(",").map((phone) => phone.trim()).filter(Boolean))];
  const values = [apiKey, username, senderId, ownerPhones.length > 0 ? "configured" : ""];
  if (values.every((value) => !value)) {
    console.warn("Owner SMS is disabled because the Wigal FROG configuration is missing.");
    return null;
  }
  if (values.some((value) => !value)) {
    console.warn("Owner SMS is disabled because the Wigal FROG configuration is incomplete.");
    return null;
  }
  return { apiKey, username, senderId, ownerPhones };
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }
function paymentMethodLabel(method: string) { return method.replaceAll("_", " ").toLowerCase(); }

function rejectionDetails(body: unknown, config: FrogConfig) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  const details = body as Record<string, unknown>;
  const safeValue = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    let result = String(value).replace(/\s+/g, " ").trim();
    for (const secret of [config.apiKey, config.username, config.senderId, ...config.ownerPhones]) {
      if (secret.length >= 4) result = result.replaceAll(secret, "[redacted]");
    }
    return result.slice(0, 240);
  };
  const providerCode = safeValue(details.code);
  const providerMessage = safeValue(details.message) ?? safeValue(details.error);
  return {
    ...(providerCode ? { providerCode } : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
}

export function purchaseConfirmationSms(notification: PurchaseSms) {
  return compact(`BJG purchase ${notification.reference} confirmed. Supplier: ${notification.supplierName}. Weight: ${formatWeight(notification.quantityKg)}. Value: ${formatCurrencyExact(notification.totalAmount)}. Paid: ${formatCurrencyExact(notification.amountPaid)}. By: ${notification.recordedBy}.`);
}

export function saleConfirmationSms(notification: SaleSms) {
  return compact(`BJG sale ${notification.reference} confirmed. Customer: ${notification.customerName ?? "Walk-in"}. Weight: ${formatWeight(notification.quantityKg)}. Total: ${formatCurrencyExact(notification.totalAmount)}. Paid: ${formatCurrencyExact(notification.amountPaid)}. By: ${notification.recordedBy}.`);
}

export function paymentConfirmationSms(notification: PaymentSms) {
  const subject = notification.tradeReference ? `for ${notification.tradeReference}` : notification.customerName ? `for ${notification.customerName}` : "";
  return compact(`BJG payment ${notification.reference} confirmed. ${notification.direction.toLowerCase()} ${formatCurrencyExact(notification.amount)} via ${paymentMethodLabel(notification.method)} ${subject}. By: ${notification.recordedBy}.`);
}

export async function sendOwnerPaymentSms(paymentId: string, recordedBy: string) {
  try {
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        customer: { select: { name: true } },
        trade: { select: { reference: true } },
        customerAdvance: { select: { reference: true } },
        buyerFinanceAccount: { select: { reference: true } },
        saleCorrection: {
          select: {
            reference: true,
            trade: { select: { reference: true } },
          },
        },
      },
    });
    const tradeReference = payment.trade?.reference
      ?? payment.saleCorrection?.trade.reference
      ?? payment.customerAdvance?.reference
      ?? payment.buyerFinanceAccount?.reference;
    await sendOwnerSms(paymentConfirmationSms({
      reference: payment.reference,
      direction: payment.direction,
      amount: payment.amount.toString(),
      method: payment.method,
      customerName: payment.customer?.name,
      tradeReference,
      recordedBy,
    }));
  } catch (error) {
    console.error("Payment was recorded, but its owner SMS could not be prepared.", error);
  }
}

/** A provider outage must never reverse a posted financial or inventory record. */
export async function sendOwnerSms(message: string) {
  const config = frogConfig();
  if (!config) return false;
  try {
    const response = await fetch(FROG_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "API-KEY": config.apiKey, USERNAME: config.username },
      body: JSON.stringify({
        senderid: config.senderId,
        destinations: config.ownerPhones.map((destination) => ({
          destination,
          message,
          msgid: crypto.randomUUID(),
          smstype: "text",
        })),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as unknown;
      console.error("Owner SMS could not be queued by Wigal FROG.", {
        status: response.status,
        ...rejectionDetails(body, config),
      });
      return false;
    }
    const body = await response.json().catch(() => null) as { status?: string } | null;
    if (body?.status && body.status !== "ACCEPTD") {
      console.error("Owner SMS was not accepted by Wigal FROG.", { status: body.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Owner SMS could not be sent.", error instanceof Error ? { name: error.name } : {});
    return false;
  }
}
