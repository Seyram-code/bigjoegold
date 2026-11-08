"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { fieldControlClass } from "@/components/ui/form-field";

type CalendarPickerProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  includeTime?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  autoComplete?: string;
  ariaLabel?: string;
  className?: string;
};

const datePart = (value: string) => value.slice(0, 10);
const localDateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDateTimeValue = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};
const parseDate = (value: string) => {
  const [year, month, day] = datePart(value).split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthTitle = (date: Date) => date.toLocaleDateString("en-GH", { month: "long", year: "numeric" });
const MAX_CLOCK_CACHE_MS = 60_000;
let cachedClockOffsetMs: number | null = null;
let cachedClockAt = 0;
let clockRequest: Promise<number> | null = null;

function getServerClockOffset() {
  if (cachedClockOffsetMs !== null && Date.now() - cachedClockAt < MAX_CLOCK_CACHE_MS) {
    return Promise.resolve(cachedClockOffsetMs);
  }
  if (clockRequest) return clockRequest;

  clockRequest = (async () => {
    const startedAt = Date.now();
    const response = await fetch("/api/clock", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to synchronize date and time (${response.status})`);
    const body: unknown = await response.json();
    const receivedAt = Date.now();
    if (!body || typeof body !== "object" || !("now" in body) || typeof body.now !== "string") {
      throw new Error("The time service returned an invalid response");
    }
    const serverTime = Date.parse(body.now);
    if (!Number.isFinite(serverTime)) throw new Error("The time service returned an invalid timestamp");
    cachedClockOffsetMs = serverTime - (startedAt + receivedAt) / 2;
    cachedClockAt = receivedAt;
    return cachedClockOffsetMs;
  })().finally(() => {
    clockRequest = null;
  });
  return clockRequest;
}

function displayValue(value: string, includeTime: boolean) {
  const date = parseDate(value);
  if (!date) return "";
  const formattedDate = date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  if (!includeTime || value.length < 16) return formattedDate;
  const [hour, minute] = value.slice(11, 16).split(":").map(Number);
  const time = new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  return `${formattedDate} · ${time}`;
}

function validDate(value: string) {
  const parsed = parseDate(value);
  return parsed !== null && localDateString(parsed) === datePart(value);
}

export function CalendarPicker({
  id,
  value,
  onChange,
  includeTime = false,
  required = false,
  min,
  max,
  autoComplete,
  ariaLabel,
  className,
}: CalendarPickerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(parseDate(value) ?? new Date()));
  const [selectedTime, setSelectedTime] = useState(() => value.length >= 16 ? value.slice(11, 16) : "12:00");
  const initialValue = useRef(value);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const includeTimeRef = useRef(includeTime);
  valueRef.current = value;
  onChangeRef.current = onChange;
  includeTimeRef.current = includeTime;
  const [clockOffsetMs, setClockOffsetMs] = useState<number | null>(null);
  const [clockSyncError, setClockSyncError] = useState<string | null>(null);
  const [, setClockTick] = useState(0);
  const serverNow = clockOffsetMs === null ? null : new Date(Date.now() + clockOffsetMs);
  const today = serverNow ?? new Date();
  const serverMax = serverNow ? localDateTimeValue(serverNow) : "";
  const browserToday = new Date();
  const browserTodayValues = [localDateString(browserToday), browserToday.toISOString().slice(0, 10)];
  const serverDateMax = serverNow ? localDateString(serverNow) : "";
  const effectiveMax = includeTime
    ? serverMax || max
    : max && serverDateMax && browserTodayValues.includes(datePart(max)) ? serverDateMax : max;
  const selectedDate = parseDate(value);
  const minDate = min ? datePart(min) : "";
  const maxDate = effectiveMax ? datePart(effectiveMax) : "";
  const firstYear = min ? Number(minDate.slice(0, 4)) : 1900;
  const lastYear = effectiveMax ? Number(maxDate.slice(0, 4)) : new Date().getFullYear() + 10;
  const firstYearOption = Math.min(firstYear, visibleMonth.getFullYear());
  const lastYearOption = Math.max(lastYear, visibleMonth.getFullYear());
  const years = Array.from({ length: lastYearOption - firstYearOption + 1 }, (_, index) => firstYearOption + index);
  const months = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1).toLocaleDateString("en-GH", { month: "long" }));

  useEffect(() => {
    let active = true;
    void getServerClockOffset().then((offset) => {
      if (!active) return;
      setClockOffsetMs(offset);
      const currentValue = valueRef.current;
      if (!includeTimeRef.current) {
        const browserTodayValues = [localDateString(new Date()), new Date().toISOString().slice(0, 10)];
        const serverDate = localDateString(new Date(Date.now() + offset));
        if (initialValue.current === currentValue && browserTodayValues.includes(datePart(currentValue)) && currentValue !== serverDate) {
          onChangeRef.current(serverDate);
        }
        return;
      }
      if (currentValue.length < 16) return;
      const serverNowMs = Date.now() + offset;
      const currentSelectedAt = new Date(currentValue).getTime();
      const initialWasSetToCurrentTime = initialValue.current === currentValue
        && Math.abs(currentSelectedAt - Date.now()) <= 15 * 60_000;
      if (currentSelectedAt > serverNowMs || initialWasSetToCurrentTime) {
        const synchronizedValue = localDateTimeValue(new Date(Math.floor(serverNowMs / 60_000) * 60_000));
        if (synchronizedValue !== currentValue) onChangeRef.current(synchronizedValue);
      }
      setClockSyncError(null);
    }).catch((error: unknown) => {
      console.error("Unable to synchronize calendar with server time", error);
      if (active) setClockSyncError("Could not synchronize with server time. Please refresh before recording this date.");
    });
    const interval = window.setInterval(() => {
      setClockTick(Date.now());
      if (cachedClockOffsetMs === null || Date.now() - cachedClockAt >= MAX_CLOCK_CACHE_MS) {
        void getServerClockOffset().then((offset) => {
          if (active) {
            setClockOffsetMs(offset);
            setClockSyncError(null);
          }
        }).catch((error: unknown) => {
          console.error("Unable to refresh calendar server time", error);
          if (active) setClockSyncError("Could not synchronize with server time. Please refresh before recording this date.");
        });
      }
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (clockOffsetMs === null || !includeTime || value.length < 16) return;
    const serverNowMs = Date.now() + clockOffsetMs;
    if (new Date(value).getTime() > serverNowMs) {
      const synchronizedValue = localDateTimeValue(new Date(Math.floor(serverNowMs / 60_000) * 60_000));
      if (synchronizedValue !== value) onChange(synchronizedValue);
    }
  }, [clockOffsetMs, includeTime, onChange, value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (validDate(value)) {
      const date = parseDate(value);
      if (date) setVisibleMonth(monthStart(date));
      if (value.length >= 16) setSelectedTime(value.slice(11, 16));
    }
  }, [value]);

  const days = useMemo(() => {
    const first = monthStart(visibleMonth);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [visibleMonth]);

  function timeForDate(date: Date, time: string) {
    const day = localDateString(date);
    const selected = `${day}T${time}`;
    if (min && day === minDate && min.length >= 16 && selected < min.slice(0, 16)) return min.slice(11, 16);
    if (effectiveMax && day === maxDate && effectiveMax.length >= 16 && selected > effectiveMax.slice(0, 16)) return effectiveMax.slice(11, 16);
    return time;
  }

  function selectDate(date: Date) {
    const day = localDateString(date);
    if ((minDate && day < minDate) || (maxDate && day > maxDate)) return;
    if (includeTime) {
      const time = timeForDate(date, selectedTime || "12:00");
      setSelectedTime(time);
      onChange(`${day}T${time}`);
    } else {
      onChange(day);
      setOpen(false);
    }
  }

  function updateTime(part: "hour" | "minute" | "period", next: string) {
    const [currentHour, currentMinute] = selectedTime.split(":").map(Number);
    let hour12 = currentHour % 12 || 12;
    let period = currentHour >= 12 ? "PM" : "AM";
    let minute = currentMinute;
    if (part === "hour") hour12 = Number(next);
    if (part === "minute") minute = Number(next);
    if (part === "period") period = next;
    const hour24 = (hour12 % 12) + (period === "PM" ? 12 : 0);
    const requestedTime = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const time = selectedDate ? timeForDate(selectedDate, requestedTime) : requestedTime;
    setSelectedTime(time);
    if (selectedDate) onChange(`${localDateString(selectedDate)}T${time}`);
  }

  const selectedHour = Number(selectedTime.slice(0, 2));
  const selectedMinute = Number(selectedTime.slice(3, 5));
  const restrictByTime = (date: Date, hour: number, minute: number) => {
    const day = localDateString(date);
    const current = `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return Boolean((min && day === minDate && current < min.slice(0, 16)) || (effectiveMax && day === maxDate && current > effectiveMax.slice(0, 16)));
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          required={required}
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          value={displayValue(value, includeTime)}
          placeholder={includeTime ? "Select date and time" : "Select date"}
          onChange={() => undefined}
          onBeforeInput={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((current) => !current);
            } else if (event.key !== "Tab") {
              event.preventDefault();
            }
          }}
          onClick={() => {
            if (!open) setVisibleMonth(monthStart(parseDate(value) ?? new Date()));
            setOpen((current) => !current);
          }}
          className={`${fieldControlClass} cursor-pointer pr-10 ${className ?? ""}`}
        />
        <button
          type="button"
          aria-label="Open calendar"
          aria-controls={`${id}-calendar`}
          aria-expanded={open}
          onClick={() => {
            if (!open) setVisibleMonth(monthStart(parseDate(value) ?? new Date()));
            setOpen((current) => !current);
          }}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-xl text-[#7b8793] transition hover:bg-[#f7f8fa] hover:text-[#9a6a1d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bc8c36]"
        >
          <CalendarDays size={16} />
        </button>
      </div>

      {open && <div id={`${id}-calendar`} role="dialog" aria-label="Choose date" className="absolute left-0 top-[calc(100%+6px)] z-[80] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#e8ebef] bg-white p-3.5 shadow-[0_16px_48px_rgba(23,33,47,.18)]">
        {clockSyncError && <p role="alert" className="mb-2 text-xs text-red-700">{clockSyncError}</p>}
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))} className="grid size-8 place-items-center rounded-lg text-[#637083] hover:bg-[#f7f8fa] hover:text-[#9a6a1d]"><ChevronLeft size={17} /></button>
          <div className="flex items-center gap-1">
            <select
              aria-label="Select month"
              value={visibleMonth.getMonth()}
              onChange={(event) => setVisibleMonth((date) => new Date(date.getFullYear(), Number(event.target.value), 1))}
              className="h-8 max-w-32 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-[#253243] outline-none hover:bg-[#f7f8fa] focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15"
            >
              {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
            </select>
            <select
              aria-label="Select year"
              value={visibleMonth.getFullYear()}
              onChange={(event) => setVisibleMonth((date) => new Date(Number(event.target.value), date.getMonth(), 1))}
              className="h-8 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-[#253243] outline-none hover:bg-[#f7f8fa] focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15"
            >
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))} className="grid size-8 place-items-center rounded-lg text-[#637083] hover:bg-[#f7f8fa] hover:text-[#9a6a1d]"><ChevronRight size={17} /></button>
        </div>

        <div role="grid" aria-label={monthTitle(visibleMonth)} className="grid grid-cols-7 gap-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <div key={day} role="columnheader" className="grid h-7 place-items-center text-[10px] font-semibold uppercase tracking-wide text-[#98a1ac]">{day}</div>)}
          {days.map((day) => {
            const dayString = localDateString(day);
            const inMonth = day.getMonth() === visibleMonth.getMonth();
            const isSelected = selectedDate !== null && localDateString(selectedDate) === dayString;
            const disabled = (minDate && dayString < minDate) || (maxDate && dayString > maxDate);
            return <button
              key={dayString}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={day.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              disabled={Boolean(disabled)}
              onClick={() => selectDate(day)}
              className={`grid size-9 place-items-center rounded-xl text-xs tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bc8c36] disabled:cursor-not-allowed disabled:opacity-30 ${isSelected ? "bg-[#bc8c36] font-semibold text-white shadow-sm" : inMonth ? "text-[#344151] hover:bg-[#f5e3b0] hover:text-[#795719]" : "text-[#b0b7c0] hover:bg-[#f7f8fa]"}`}
            >{day.getDate()}</button>;
          })}
        </div>

        {includeTime && <div className="mt-3 border-t border-[#edf0f3] pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#89929d]">Time</p>
          <div className="grid grid-cols-3 gap-2">
            <select aria-label="Hour" value={selectedHour % 12 || 12} onChange={(event) => updateTime("hour", event.target.value)} className="h-9 rounded-lg border border-[#dfe4e9] bg-white px-2 text-xs text-[#344151] outline-none focus:border-[#bc8c36]">
              {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}</option>)}
            </select>
            <select aria-label="Minute" value={selectedMinute} onChange={(event) => updateTime("minute", event.target.value)} className="h-9 rounded-lg border border-[#dfe4e9] bg-white px-2 text-xs text-[#344151] outline-none focus:border-[#bc8c36]">
              {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => <option key={minute} value={minute}>{String(minute).padStart(2, "0")}</option>)}
            </select>
            <select aria-label="AM or PM" value={selectedHour >= 12 ? "PM" : "AM"} onChange={(event) => updateTime("period", event.target.value)} className="h-9 rounded-lg border border-[#dfe4e9] bg-white px-2 text-xs text-[#344151] outline-none focus:border-[#bc8c36]">
              <option>AM</option>
              <option>PM</option>
            </select>
          </div>
          {selectedDate && ((min && min.length >= 16 && localDateString(selectedDate) === minDate && restrictByTime(selectedDate, selectedHour, selectedMinute)) || (effectiveMax && effectiveMax.length >= 16 && localDateString(selectedDate) === maxDate && restrictByTime(selectedDate, selectedHour, selectedMinute))) && <AlertDialog open title="Invalid time" description="Choose a time within the allowed range." onConfirm={() => {}} />}
        </div>}

        <div className="mt-3 flex items-center justify-between border-t border-[#edf0f3] pt-2.5">
          {!required ? <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#75808d] hover:bg-[#f7f8fa]">Clear</button> : <span />}
          <div className="flex gap-2">
            <button type="button" disabled={Boolean((minDate && localDateString(today) < minDate) || (maxDate && localDateString(today) > maxDate))} onClick={() => selectDate(today)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#795719] hover:bg-[#f5e3b0] disabled:cursor-not-allowed disabled:opacity-40">Today</button>
            {includeTime && <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-[#17212f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#26384d]">Done</button>}
          </div>
        </div>
      </div>}
    </div>
  );
}
