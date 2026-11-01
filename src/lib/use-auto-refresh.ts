"use client";

import { useEffect, useRef } from "react";

const AUTO_REFRESH_INTERVAL_MS = 30000;

export function useAutoRefresh(callback: () => Promise<void> | void, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let refreshing = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      void Promise.resolve(callbackRef.current())
        .catch((error: unknown) => console.error("Automatic workspace refresh failed", error))
        .finally(() => {
          refreshing = false;
        });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled]);
}
