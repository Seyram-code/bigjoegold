import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { CalendarPicker } from "@/components/ui/calendar-picker";

export function DateFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  busy = false,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#e8ebef] bg-white p-4">
      <FormField label="From" htmlFor="report-date-from"><CalendarPicker id="report-date-from" value={from} onChange={onFromChange} max={to} /></FormField>
      <FormField label="To" htmlFor="report-date-to"><CalendarPicker id="report-date-to" value={to} onChange={onToChange} min={from} max={new Date().toISOString().slice(0, 10)} /></FormField>
      <Button size="sm" variant="outline" onClick={onApply} disabled={busy}><CalendarDays size={14} /> Apply range</Button>
    </div>
  );
}
