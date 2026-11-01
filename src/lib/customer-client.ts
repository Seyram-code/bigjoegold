export async function fetchAllCustomers<T extends { id: string }>(kind: "BUYER" | "SUPPLIER", status = "ACTIVE"): Promise<T[]> {
  const params = new URLSearchParams({ kind, status, picker: "true" });
  const response = await fetch(`/api/customers?${params}`, { cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(readError(body, "Unable to load customers"));
  if (!isRecord(body) || !Array.isArray(body.customers)) {
    throw new Error("The customer service returned an invalid picker response");
  }
  return body.customers.map((customer) => {
    if (!isRecord(customer) || typeof customer.id !== "string") {
      throw new Error("The customer service returned an invalid customer record");
    }
    return customer as T;
  });
}

function readError(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
