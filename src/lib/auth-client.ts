"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL
    ?? (typeof window === "undefined"
      ? process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000"
      : window.location.origin),
});
