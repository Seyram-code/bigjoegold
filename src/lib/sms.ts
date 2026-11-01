import { formatCurrencyExact, formatWeight } from "@/lib/formatters";

const FROG_SEND_URL = "https://frogapi.wigal.com.gh/api/v3/sms/send";
const REQUEST_TIMEOUT_MS = 10_000;

type FrogConfig = { apiKey: string; username: string; senderId: string; ownerPhone: string };
type PurchaseSms = { reference: string; supplierName: string; quantityKg: string | number; totalAmount: string | number; amountPaid: string | number; recordedBy: string };
type SaleSms = { reference: string; customerName?: string | null; quantityKg: string | number; totalAmount: string | number; amountPaid: string | number; recordedBy: string };
type PaymentSms = { reference: string; direction: "INBOUND" | "OUTBOUND"; amount: string | number; method: string; customerName?: string | null; tradeReference?: string | null; recordedBy: string };

function required(value: string | undefined) { return value?.trim() ?? ""; }

function frogConfig(): FrogConfig | null {
  const apiKey = required(process.env.WIGAL_FROG_API_KEY);
  const username = required(process.env.WIGAL_FROG_USERNAME);
  const senderId = required(process.env.WIGAL_FROG_SENDER_ID);
  const ownerPhone = required(process.env.WIGAL_FROG_OWNER_PHONE);
  const values = [apiKey, username, senderId, ownerPhone];
  if (values.every((value) => !value)) {
    console.warn("Owner SMS is disabled because the Wigal FROG configuration is missing.");
    return null;
  }
  if (values.some((value) => !value)) {
    console.warn("Owner SMS is disabled because the Wigal FROG configuration is incomplete.");
    return null;
  }
  return { apiKey, username, senderId, ownerPhone };
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }
function paymentMethodLabel(method: string) { return method.replaceAll("_", " ").toLowerCase(); }

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

/** A provider outage must never reverse a posted financial or inventory record. */
export async function sendOwnerSms(message: string) {
  const config = frogConfig();
  if (!config) return false;
  try {
    const response = await fetch(FROG_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "API-KEY": config.apiKey, USERNAME: config.username },
      body: JSON.stringify({ senderid: config.senderId, destinations: [{ destination: config.ownerPhone, msgid: crypto.randomUUID() }], message, smstype: "text" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Owner SMS could not be queued by Wigal FROG.", { status: response.status });
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
