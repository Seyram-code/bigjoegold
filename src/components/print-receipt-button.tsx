"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintReceiptButton() {
  return <Button variant="gold" size="sm" className="print-hide" onClick={() => window.print()}>
    <Printer size={14} /> Print receipt
  </Button>;
}
