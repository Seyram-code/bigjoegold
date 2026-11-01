"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" className="w-full max-w-[420px] rounded-2xl border border-[#e8ebef] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.24)]">
        <div className={`flex size-10 items-center justify-center rounded-xl ${destructive ? "bg-rose-50 text-rose-600" : "bg-[#f5e3b0] text-[#795719]"}`}><AlertTriangle size={19} /></div>
        <h2 id="confirm-title" className="mt-4 text-base font-semibold text-[#17212f]">{title}</h2>
        <p id="confirm-description" className="mt-2 text-sm leading-6 text-[#74808d]">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "danger" : "gold"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}
