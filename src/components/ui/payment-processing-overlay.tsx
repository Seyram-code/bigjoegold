"use client";

import { LoaderCircle } from "lucide-react";

export function PaymentProcessingOverlay({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0c1521]/70 p-4 backdrop-blur-sm" role="status" aria-live="polite">
    <div className="flex min-w-[260px] flex-col items-center gap-3 rounded-xl border border-[#d6aa42] bg-white px-8 py-7 text-center shadow-2xl">
      <LoaderCircle size={34} className="animate-spin text-[#a97520]" aria-hidden="true" />
      <p className="text-sm font-semibold text-[#17212f]">{message}</p>
      <p className="text-xs text-[#637083]">Please wait while we confirm and save this transaction.</p>
    </div>
  </div>;
}
