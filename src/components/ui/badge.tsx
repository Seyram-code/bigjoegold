import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  gold: "bg-[#f5e3b0] text-[#795719]",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-rose-50 text-rose-700",
  blue: "bg-blue-50 text-blue-700",
  neutral: "bg-slate-100 text-slate-600",
};

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: keyof typeof styles; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold", styles[tone], className)}>{children}</span>;
}
