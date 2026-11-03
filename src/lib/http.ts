import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { formatCurrency, formatWeight } from "@/lib/formatters";

export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter?: number) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (error instanceof Response) {
    return Response.json({ error: error.status === 401 ? "Authentication required" : "You do not have permission to perform this action" }, { status: error.status });
  }
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        ...(error.retryAfter ? { headers: { "Retry-After": String(error.retryAfter) } } : {}),
      },
    );
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "Validation failed", fields: error.flatten().fieldErrors }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return Response.json({ error: "A record with that unique value already exists" }, { status: 409 });
    if (error.code === "P2003" || error.code === "P2025") return Response.json({ error: "The referenced record no longer exists or cannot be changed" }, { status: 409 });
  }
  console.error("API request failed", error);
  return Response.json({ error: "An unexpected error occurred. Check the server logs." }, { status: 500 });
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const expectedOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (origin) {
    const originUrl = new URL(origin);
    const sameLocalhost = ["127.0.0.1", "localhost", "[::1]"]
      .includes(originUrl.hostname)
      && ["127.0.0.1", "localhost", "[::1]"]
        .includes(requestUrl.hostname)
      && originUrl.port === requestUrl.port;
    if (!sameLocalhost && origin !== expectedOrigin) {
      throw new HttpError("Cross-origin or originless mutations are not allowed", 403);
    }
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new HttpError("Content-Type must be application/json", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError("Request body is too large", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("A JSON request body is required", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError("Request body is too large", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError("Request body must contain valid JSON", 400);
  }
}

export function money(value: number | string) {
  return formatCurrency(value);
}

export function kilograms(value: number | string) {
  return formatWeight(value);
}
