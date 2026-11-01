"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefreshButton({
  loading = false,
  onClick,
  label = "Refresh",
  className,
}: {
  loading?: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="gold"
      size="sm"
      onClick={onClick}
      disabled={loading}
      className={`h-10 rounded-xl px-4 shadow-sm shadow-[#bc8c36]/15 transition hover:-translate-y-0.5 hover:shadow-md disabled:translate-y-0 ${className ?? ""}`}
    >
      <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
      {loading ? "Refreshing…" : label}
    </Button>
  );
}
