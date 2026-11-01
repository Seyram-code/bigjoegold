"use client";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold tracking-[-.01em] text-[#465362]">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-4 text-[#89929e]">{hint}</p>}
      {error && <AlertDialog open title="Please check this field" description={error} onConfirm={() => {}} />}
    </div>
  );
}

export const fieldControlClass = "h-11 w-full rounded-xl border border-[#dfe4e9] bg-white px-3.5 text-[13px] text-[#263241] shadow-sm shadow-[#17212f]/[.025] outline-none transition duration-150 placeholder:text-[#a0a8b2] hover:border-[#c7ced6] focus:border-[#bc8c36] focus:ring-4 focus:ring-[#bc8c36]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f7] disabled:text-[#929ba6] read-only:cursor-default read-only:bg-[#f7f8fa] read-only:text-[#5b6673] file:mr-3 file:rounded-lg file:border-0 file:bg-[#f5f0e6] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#79591f]";
