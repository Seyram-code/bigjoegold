"use client";

import { useEffect } from "react";

const storageKey = (method: string, url: string, body: string) => `bjg:idempotency:${method}:${url}:${body}`;

export function IdempotencyProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" || input instanceof URL ? new URL(input, window.location.href) : new URL(input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const body = typeof init?.body === "string" ? init.body : "";
      const isWorkspaceMutation = requestUrl.origin === window.location.origin
        && requestUrl.pathname.startsWith("/api/")
        && !requestUrl.pathname.startsWith("/api/auth/")
        && ["POST", "PUT", "PATCH", "DELETE"].includes(method)
        && body.length > 0;
      if (!isWorkspaceMutation) return originalFetch(input, init);

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Idempotency-Key")) {
        const key = storageKey(method, requestUrl.pathname, body);
        const existing = window.sessionStorage.getItem(key);
        const idempotencyKey = existing ?? crypto.randomUUID();
        window.sessionStorage.setItem(key, idempotencyKey);
        headers.set("Idempotency-Key", idempotencyKey);
        const response = await originalFetch(input, { ...init, method, headers });
        if (response.ok) window.sessionStorage.removeItem(key);
        return response;
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return children;
}
