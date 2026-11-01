"use client";

import { useEffect, useId, useReducer, useRef } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel = "Okay",
  variant = "error",
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "error" | "warning";
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dismissedMessage = useRef("");
  const [, forceRender] = useReducer((revision: number) => revision + 1, 0);
  const id = useId();
  const visible = open && description !== dismissedMessage.current;

  useEffect(() => {
    if (!open) {
      dismissedMessage.current = "";
      return;
    }
    if (!visible) return;
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if ((event.key === "Escape" || event.key === "Enter") && document.activeElement === confirmRef.current) {
        event.preventDefault();
        confirmRef.current?.click();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, visible]);

  if (!visible) return null;
  const handleConfirm = () => {
    dismissedMessage.current = description;
    forceRender();
    confirmRef.current?.blur();
    onConfirm();
  };
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]">
      <section role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-[420px] rounded-2xl border border-[#e8ebef] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.24)]">
        <div className={`flex size-10 items-center justify-center rounded-xl ${variant === "warning" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>
          {variant === "warning" ? <AlertTriangle size={19} /> : <AlertCircle size={19} />}
        </div>
        <h2 id={titleId} className="mt-4 text-base font-semibold text-[#17212f]">{title}</h2>
        <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-6 text-[#74808d]">{description}</p>
        <div className="mt-6 flex justify-end">
          <Button ref={confirmRef} variant="gold" onClick={handleConfirm}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}
