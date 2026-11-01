"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

type Toast = { id: number; message: string; duration: number };
type ToastContextValue = {
  success: (message: string, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message: string, duration: number) => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, duration }]);
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    }
  }, [dismiss]);
  const success = useCallback((message: string, duration = 5000) => addToast(message, duration), [addToast]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  return <ToastContext.Provider value={{ success }}>
    {children}
    <div aria-live="polite" aria-label="Notifications" className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => <div key={toast.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-[#253243] shadow-[0_12px_36px_rgba(15,23,42,.16)]">
        <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-5">{toast.message}</p>
        <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="shrink-0 rounded-md p-1 text-[#8c95a0] hover:bg-[#f1f3f5] hover:text-[#17212f]">
          <X size={15} />
        </button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
