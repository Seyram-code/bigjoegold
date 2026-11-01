import { CalendarPicker } from "@/components/ui/calendar-picker";

export function GhanaDateInput({
  id,
  value,
  onChange,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <CalendarPicker
      id={id}
      includeTime={false}
      autoComplete="bday"
      max={new Date().toISOString().slice(0, 10)}
      required={required}
      value={value}
      onChange={onChange}
    />
  );
}
