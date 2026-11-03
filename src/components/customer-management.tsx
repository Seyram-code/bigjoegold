"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { readSheet } from "read-excel-file/browser";
import { CalendarDays, ChevronDown, CircleDot, Download, Eye, FileSpreadsheet, FileText, Filter, LoaderCircle, Mail, MapPin, MoreHorizontal, Pencil, Plus, RotateCcw, Upload, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { customerSchema, type CustomerInput } from "@/lib/validation";
import {
  CUSTOMER_IMPORT_COLUMNS,
  customerImportFieldForHeader,
  customerImportRowSchema,
  MAX_CUSTOMER_IMPORT_ROWS,
  type CustomerImportField,
  normalizeCustomerImportValue,
} from "@/lib/customer-import";
import { customerCsvRow } from "@/lib/customer-csv";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { FormField, fieldControlClass } from "@/components/ui/form-field";
import { GhanaDateInput } from "@/components/ui/ghana-date-input";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { formatCurrency, formatWeight } from "@/lib/formatters";
import { formatDecimalTruncated } from "@/lib/decimal-policy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

function CustomerListFilter({
  label,
  icon: Icon,
  value,
  onChange,
  options,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="group relative flex h-10 min-w-[145px] items-center gap-2.5 rounded-xl border border-[#e5e9ee] bg-gradient-to-b from-white to-[#fbfcfd] px-3 text-[#738091] shadow-sm shadow-[#17212f]/[.025] transition hover:border-[#d3b36e] hover:shadow-[0_3px_10px_rgba(154,106,29,.08)] focus-within:border-[#bc8c36] focus-within:ring-4 focus-within:ring-[#bc8c36]/10">
      <Icon aria-hidden="true" size={15} className="shrink-0 text-[#a17a35] transition group-hover:text-[#8a611f]" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-5 text-[12px] font-medium text-[#344151] outline-none"
      >
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 text-[#8b96a3] transition group-hover:text-[#8a611f]" />
    </label>
  );
}

type Customer = {
  id: string;
  code: string;
  name: string;
  type: "INDIVIDUAL" | "BUSINESS";
  phone?: string | null;
  alternativePhone?: string | null;
  email?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  gender?: CustomerInput["gender"] | null;
  idType?: CustomerInput["idType"] | null;
  idNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  gpsLocation?: string | null;
  tin?: string | null;
  transactionTotals?: { quantityKg: number; totalAmount: number };
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
};

type Duplicate = { id: string; code: string; name: string; type: string; reasons: string[]; phone?: string | null };
type CustomerImportRow = { rowNumber: number; data: Record<string, unknown> };
type CustomerImportResult = {
  imported: number;
  skipped: number;
  rows: { rowNumber: number; status: "imported" | "duplicate" | "invalid"; reason?: string }[];
};

const emptyCustomer: CustomerInput = {
  name: "",
  kind: "BUYER",
  type: "INDIVIDUAL",
  phone: "",
  alternativePhone: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  idType: "",
  idNumber: "",
  tin: "",
  address: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  country: "Ghana",
  gpsLocation: "",
  notes: "",
};

const ghanaRegions = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern",
  "Greater Accra", "North East", "Northern", "Oti", "Savannah",
  "Upper East", "Upper West", "Volta", "Western", "Western North",
];

export function CustomerManagement({
  kind,
  canWrite,
  canReadPersonal,
  canReadTrades,
  canExport,
}: {
  kind: "BUYER" | "SUPPLIER";
  canWrite: boolean;
  canReadPersonal: boolean;
  canReadTrades: boolean;
  canExport: boolean;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("");
  const [dateRange, setDateRange] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ total: number; active: number; archived: number; tradeKg?: number; tradeValue?: number }>({ total: 0, active: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Customer | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<CustomerImportRow[]>([]);
  const [importValidCount, setImportValidCount] = useState(0);
  const [importInvalidCount, setImportInvalidCount] = useState(0);
  const [importResult, setImportResult] = useState<CustomerImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [importReading, setImportReading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const form = useForm<CustomerInput>({ resolver: zodResolver(customerSchema), defaultValues: { ...emptyCustomer, kind } });

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams({ kind, status, page: String(page), pageSize: "10", dateRange });
      if (type) params.set("type", type);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/customers?${params}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readError(body, "Unable to load customers"));
      if (!isRecord(body) || !Array.isArray(body.customers) || typeof body.total !== "number" || !isRecord(body.summary)) throw new Error("The customer service returned an invalid response");
      setCustomers(body.customers as Customer[]);
      setTotal(body.total);
      setSummary(body.summary as typeof summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load customers");
    } finally {
      setLoading(false);
    }
  }, [dateRange, kind, page, query, status, type]);

  useEffect(() => {
    form.reset({ ...emptyCustomer, kind });
  }, [form, kind]);

  function updateSearch(value: string) {
    setPage(1);
    setQuery(value);
  }

  function updateStatus(value: string) {
    setPage(1);
    setStatus(value);
  }

  function updateType(value: string) {
    setPage(1);
    setType(value);
  }

  function updateDateRange(value: string) {
    setPage(1);
    setDateRange(value);
  }

  function resetFilters() {
    setPage(1);
    setQuery("");
    setStatus("ALL");
    setType("");
    setDateRange("ALL");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);
  useAutoRefresh(() => load(true));

  function startCreate() {
    setEditing(null);
    setDuplicates([]);
    setDuplicateConfirmed(false);
    form.reset({ ...emptyCustomer, kind });
    setShowForm(true);
  }

  function startEdit(customer: Customer) {
    setEditing(customer);
    setDuplicates([]);
    setDuplicateConfirmed(false);
    form.reset({
      name: customer.name,
      kind,
      type: customer.type,
      phone: customer.phone?.replace(/^\+?233\s*/, "") ?? "",
      alternativePhone: customer.alternativePhone ?? "",
      email: customer.email ?? "",
      dateOfBirth: customer.dateOfBirth ? new Date(customer.dateOfBirth).toISOString().slice(0, 10) : "",
      gender: customer.gender ?? "",
      idType: customer.idType ?? "",
      idNumber: customer.idNumber ?? "",
      tin: customer.tin ?? "",
      address: customer.address ?? "",
      addressLine1: customer.addressLine1 ?? customer.address ?? "",
      addressLine2: customer.addressLine2 ?? "",
      city: customer.city ?? "",
      region: customer.region ?? "",
      country: customer.country ?? "Ghana",
      gpsLocation: customer.gpsLocation ?? "",
      notes: customer.notes ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    if (form.formState.isSubmitting) return;
    setShowForm(false);
    setEditing(null);
    setDuplicates([]);
    setDuplicateConfirmed(false);
    form.reset({ ...emptyCustomer, kind });
  }

  useEffect(() => {
    if (!showForm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !form.formState.isSubmitting) {
        setShowForm(false);
        setEditing(null);
        setDuplicates([]);
        setDuplicateConfirmed(false);
        form.reset({ ...emptyCustomer, kind });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [form, form.formState.isSubmitting, kind, showForm]);

  async function save(values: CustomerInput, skipDuplicateCheck = false) {
    setError("");
    if (!editing && !skipDuplicateCheck) {
      try {
        const params = new URLSearchParams({ name: values.name, kind });
        if (values.phone) params.set("phone", normalizePhone(values.phone));
        if (values.email) params.set("email", values.email);
        const response = await fetch(`/api/customers/duplicates?${params}`, { cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(readError(body, "Unable to check for duplicate customers"));
        if (!Array.isArray(body)) throw new Error("The duplicate-check service returned an invalid response");
        if (body.length) {
          setDuplicates(body as Duplicate[]);
          setDuplicateConfirmed(true);
          return;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to check for duplicate customers");
        return;
      }
    }

    try {
      const { kind: formKind, ...editableValues } = values;
      const customerData = editing
        ? !canReadPersonal
          ? { name: values.name, type: values.type }
          : {
            ...editableValues,
            phone: normalizePhone(values.phone),
            dateOfBirth: values.dateOfBirth || "",
            country: values.country || "Ghana",
            address: [values.addressLine1, values.addressLine2].filter(Boolean).join(", ") || values.address || "",
          }
        : {
          ...editableValues,
          kind: formKind,
          phone: normalizePhone(values.phone),
          dateOfBirth: values.dateOfBirth || "",
          country: values.country || "Ghana",
          address: [values.addressLine1, values.addressLine2].filter(Boolean).join(", ") || values.address || "",
        };
      const response = await fetch(editing ? `/api/customers/${editing.id}` : "/api/customers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customerData),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readError(body, "Unable to save customer"));
      showToast(editing ? "Customer details updated." : "Customer added.");
      setShowForm(false);
      setEditing(null);
      setDuplicates([]);
      setDuplicateConfirmed(false);
      form.reset({ ...emptyCustomer, kind });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save customer");
    }
  }

  async function setArchived(customer: Customer, isActive: boolean) {
    setArchiveBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readError(body, "Unable to update customer status"));
      setPendingArchive(null);
      showToast(isActive ? "Customer restored." : "Customer archived. Historical transactions remain unchanged.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update customer status");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function exportCsv() {
    setExportBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind, status });
      params.set("dateRange", dateRange);
      if (type) params.set("type", type);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/customers/export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(readError(body, "Unable to export customer report"));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `big-joe-gold-customers-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to export customer report");
    } finally {
      setExportBusy(false);
    }
  }

  function closeImportDialog() {
    if (importBusy) return;
    setShowImportDialog(false);
    setImportFileName("");
    setImportRows([]);
    setImportValidCount(0);
    setImportInvalidCount(0);
    setImportResult(null);
    setImportError("");
  }

  function downloadImportTemplate() {
    const content = `\uFEFF${customerCsvRow(CUSTOMER_IMPORT_COLUMNS.map(({ header }) => header))}\r\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `big-joe-gold-${kind === "SUPPLIER" ? "supplier" : "customer"}-import-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readImportFile(file: File) {
    setImportError("");
    setImportResult(null);
    setImportRows([]);
    setImportValidCount(0);
    setImportInvalidCount(0);
    setImportFileName(file.name);
    if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
      setImportError("Choose an Excel workbook in .xlsx format.");
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setImportError("The Excel file must be smaller than 5 MB and cannot be empty.");
      return;
    }

    setImportReading(true);
    try {
      const worksheetRows = await readSheet(file);
      if (!worksheetRows.length) throw new Error("The first worksheet is empty.");
      const columns: { index: number; field: CustomerImportField }[] = [];
      const foundFields = new Set<CustomerImportField>();
      worksheetRows[0].forEach((header, index) => {
        const field = customerImportFieldForHeader(header);
        if (!field) return;
        if (foundFields.has(field)) throw new Error(`The worksheet has more than one column for ${field}.`);
        foundFields.add(field);
        columns.push({ index, field });
      });
      if (!foundFields.has("name") || !foundFields.has("phone")) {
        throw new Error("The first worksheet must include Customer Full Name and Phone Number columns.");
      }

      const parsedRows: CustomerImportRow[] = [];
      for (let index = 1; index < worksheetRows.length; index += 1) {
        const sourceRow = worksheetRows[index];
        if (!sourceRow.some((value) => value !== null && value !== undefined && String(value).trim() !== "")) continue;
        const data: Record<string, unknown> = {};
        for (const { index: columnIndex, field } of columns) {
          const value = sourceRow[columnIndex];
          if (value === null || value === undefined || value === "") continue;
          data[field] = importCellValue(value, field);
        }
        parsedRows.push({ rowNumber: index + 1, data });
        if (parsedRows.length > MAX_CUSTOMER_IMPORT_ROWS) {
          throw new Error(`The workbook can contain at most ${MAX_CUSTOMER_IMPORT_ROWS} customer rows.`);
        }
      }
      if (!parsedRows.length) throw new Error("The worksheet does not contain any customer rows.");

      const validCount = parsedRows.filter(({ data }) => customerImportRowSchema.safeParse(data).success).length;
      setImportRows(parsedRows);
      setImportValidCount(validCount);
      setImportInvalidCount(parsedRows.length - validCount);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Unable to read the Excel workbook.");
    } finally {
      setImportReading(false);
    }
  }

  async function importCustomers() {
    if (!importRows.length || importValidCount === 0 || importBusy) return;
    setImportBusy(true);
    setImportError("");
    try {
      const response = await fetch("/api/customers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, rows: importRows }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readError(body, "Unable to import customers"));
      if (!isCustomerImportResult(body)) throw new Error("The customer import service returned an invalid response.");
      setImportResult(body);
      if (body.imported > 0) {
        showToast(`Imported ${body.imported} customer${body.imported === 1 ? "" : "s"}; skipped ${body.skipped} row${body.skipped === 1 ? "" : "s"}.`);
      }
      await load();
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Unable to import customers.");
    } finally {
      setImportBusy(false);
    }
  }

  const groupLabel = kind === "SUPPLIER" ? "Receiving-stock suppliers" : "Sales customers";
  const previewInvalidRows = importRows.flatMap(({ rowNumber, data }) => {
    const parsed = customerImportRowSchema.safeParse(data);
    return parsed.success ? [] : [{
      rowNumber,
      reason: [...new Set(parsed.error.issues.map((issue) => issue.message))].join("; "),
    }];
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return <div className="space-y-3">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="text-[27px] font-bold leading-tight tracking-[-.03em] text-[#111820]">{groupLabel}</h1><p className="mt-0.5 text-[13px] text-[#637083]">{kind === "SUPPLIER" ? "Manage the people and businesses who sell gold to you." : "Manage the people and businesses who buy gold from you."}</p></div>
      <div className="flex flex-wrap gap-2">
        {canWrite && canReadPersonal && <Button variant="outline" size="sm" className="h-9 px-3" onClick={() => { setShowImportDialog(true); setImportError(""); }}><Upload size={15} /> Import Excel</Button>}
        {canWrite && <Button variant="gold" size="sm" className="h-9 px-4" onClick={startCreate}><Plus size={15} /> Add Customer</Button>}
      </div>
    </div>

    <section aria-label="Customer summary" className={`grid gap-2 sm:grid-cols-2 ${canReadTrades ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      <SummaryCard icon={Users} tone="purple" label="Total customers" value={summary.total.toLocaleString("en-GH")} detail="All customer accounts" />
      <SummaryCard icon={Users} tone="green" label="Active customers" value={summary.active.toLocaleString("en-GH")} detail={`${summary.total ? formatDecimalTruncated(summary.active / summary.total * 100, 0) : 0}% of customers`} />
      <SummaryCard icon={Users} tone="red" label="Archived customers" value={summary.archived.toLocaleString("en-GH")} detail={`${summary.total ? formatDecimalTruncated(summary.archived / summary.total * 100, 0) : 0}% of customers`} />
      {canReadTrades && <SummaryCard icon={UserRound} tone="blue" label={`Total ${kind === "SUPPLIER" ? "purchases" : "sales"} (KG)`} value={formatWeight(summary.tradeKg ?? 0)} detail={`Value: ${formatCurrency(summary.tradeValue ?? 0)}`} />}
    </section>

    {error && <Message tone="error" onDismiss={() => setError("")}>{error}</Message>}

    {showImportDialog && canWrite && canReadPersonal && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImportDialog(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="customer-import-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="customer-import-title" className="text-xl font-bold text-[#17212f] dark:text-slate-100">Import Customers from Excel</h2>
            <p className="mt-1 text-sm text-[#637083] dark:text-slate-300">Import {kind === "SUPPLIER" ? "receiving-stock suppliers" : "sales customers"}. Customer Full Name and Phone Number are required.</p>
          </div>
          <button type="button" onClick={closeImportDialog} aria-label="Close customer import" disabled={importBusy} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"><X size={16} /></button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e8edf3] bg-[#fbfcfe] p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-3">
              <FileSpreadsheet size={19} className="mt-0.5 shrink-0 text-[#a17a35]" />
              <div>
                <p className="text-sm font-semibold text-[#263241] dark:text-slate-100">Use the import template</p>
                <p className="mt-1 text-xs text-[#637083] dark:text-slate-300">The CSV template opens in Excel. Save your completed workbook as .xlsx before importing; only its first worksheet is read.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadImportTemplate}><Download size={14} /> Download template</Button>
          </div>

          <label className="block rounded-xl border border-dashed border-[#cbd3dd] p-4 dark:border-slate-600">
            <span className="block text-sm font-semibold text-[#263241] dark:text-slate-100">Choose an .xlsx workbook</span>
            <span className="mt-1 block text-xs text-[#637083] dark:text-slate-300">Maximum 5 MB and {MAX_CUSTOMER_IMPORT_ROWS} customer rows. Format phone numbers as text to preserve leading zeroes. Type accepts Individual or Business; dates should use YYYY-MM-DD.</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-3 block w-full text-sm text-[#536174] file:mr-3 file:rounded-lg file:border-0 file:bg-[#f5e3b0] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#795719] dark:text-slate-300"
              disabled={importReading || importBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readImportFile(file);
                event.target.value = "";
              }}
            />
          </label>

          {importFileName && <p className="text-xs text-[#536174] dark:text-slate-300">Selected: {importFileName}</p>}
          {importReading && <p className="flex items-center gap-2 text-sm text-[#637083] dark:text-slate-300"><LoaderCircle size={15} className="animate-spin" /> Reading workbook…</p>}
          {importRows.length > 0 && !importResult && <div className="rounded-xl border border-[#e8edf3] p-3 text-sm text-[#344151] dark:border-slate-700 dark:text-slate-200">
            Found {importRows.length} rows: {importValidCount} appear valid and {importInvalidCount} need correction. Existing and repeated phone numbers will be skipped.
            {previewInvalidRows.length > 0 && <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs text-red-700 dark:text-red-300">
              {previewInvalidRows.slice(0, 20).map((row) => <li key={row.rowNumber}>Excel row {row.rowNumber}: {row.reason}</li>)}
              {previewInvalidRows.length > 20 && <li>And {previewInvalidRows.length - 20} more rows need correction.</li>}
            </ul>}
          </div>}
          {importError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{importError}</p>}
          {importResult && <div className="space-y-2">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Imported {importResult.imported}; skipped {importResult.skipped}.
            </p>
            {importResult.skipped > 0 && <div className="max-h-48 overflow-auto rounded-lg border border-[#e8edf3] dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#f7f8fa] dark:bg-slate-800"><tr><th className="px-3 py-2">Excel row</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th></tr></thead>
                <tbody>{importResult.rows.filter((row) => row.status !== "imported").map((row) => <tr key={row.rowNumber} className="border-t border-[#edf0f3] dark:border-slate-700">
                  <td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2 capitalize">{row.status}</td><td className="px-3 py-2">{row.reason}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </div>}

          <div className="flex justify-end gap-2 border-t border-[#e8edf3] pt-4 dark:border-slate-700">
            <Button variant="outline" onClick={closeImportDialog} disabled={importBusy}>Close</Button>
            <Button variant="gold" onClick={() => void importCustomers()} disabled={importBusy || importReading || importValidCount === 0 || Boolean(importResult)}>
              {importBusy ? <><LoaderCircle size={15} className="animate-spin" /> Importing…</> : <><Upload size={15} /> Import {importValidCount} Customers</>}
            </Button>
          </div>
        </div>
      </section>
    </div>}

    {showForm && canWrite && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="customer-form-title" className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-[#fbfcfe] p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="customer-form-title" className="text-2xl font-bold tracking-tight text-[#17212f]">{editing ? "Edit Customer" : "Add New Customer"}</h2><p className="mt-1 text-sm text-[#637083]">{editing ? `Update the details for ${editing.name}.` : "Create a new customer and register their information."}</p></div>
          <button type="button" onClick={closeForm} aria-label="Close customer form" disabled={form.formState.isSubmitting} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50"><X size={16} /></button>
        </div>
        <form onSubmit={form.handleSubmit((values) => save(values, duplicateConfirmed && duplicates.length > 0))} className="mt-5">
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><UserRound size={17} /></span>Personal Information</h3>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <FormField label="Full Name *" htmlFor="customer-name" error={form.formState.errors.name?.message}><input id="customer-name" required placeholder="Enter full name" {...form.register("name")} className={fieldControlClass} autoComplete="name" /></FormField>
                <FormField label="Customer ID (Auto)" htmlFor="customer-code"><input id="customer-code" value={editing?.code ?? "Generated when saved"} readOnly className={fieldControlClass} /></FormField>
                {canReadPersonal && <>
                  <FormField label="Phone Number *" htmlFor="customer-phone" error={form.formState.errors.phone?.message}>
                    <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#dfe4e9] bg-white shadow-sm shadow-[#17212f]/[.025] focus-within:border-[#bc8c36] focus-within:ring-4 focus-within:ring-[#bc8c36]/10">
                      <span className="flex h-full shrink-0 items-center gap-1.5 border-r border-[#e8ebef] bg-[#fbfcfe] px-3 text-xs font-medium text-[#465362]">🇬🇭 +233</span>
                      <input id="customer-phone" type="tel" required autoComplete="tel-national" placeholder="Enter phone number" {...form.register("phone")} className="h-full min-w-0 flex-1 px-3 text-[13px] text-[#263241] outline-none placeholder:text-[#a0a8b2]" />
                    </div>
                  </FormField>
                  {editing && <>
                    <FormField label="Email Address" htmlFor="customer-email" error={form.formState.errors.email?.message}>
                      <div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8792a0]" /><input id="customer-email" type="email" placeholder="Enter email address" {...form.register("email")} className={`${fieldControlClass} pl-9`} autoComplete="email" /></div>
                    </FormField>
                    <FormField label="Date of Birth *" htmlFor="customer-dob" error={form.formState.errors.dateOfBirth?.message}><GhanaDateInput id="customer-dob" value={form.watch("dateOfBirth") ?? ""} required onChange={(dateOfBirth) => form.setValue("dateOfBirth", dateOfBirth, { shouldValidate: true, shouldDirty: true })} /></FormField>
                  </>}
                  <FormField label="Gender" htmlFor="customer-gender"><select id="customer-gender" {...form.register("gender")} className={fieldControlClass}><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></FormField>
                  <FormField label="ID Type" htmlFor="customer-id-type"><select id="customer-id-type" {...form.register("idType")} className={fieldControlClass}><option value="">Select ID type</option><option value="GHANA_CARD">Ghana Card</option><option value="PASSPORT">Passport</option><option value="DRIVERS_LICENSE">Driver’s license</option><option value="VOTER_ID">Voter ID</option><option value="OTHER">Other</option></select></FormField>
                  <FormField label="ID Number" htmlFor="customer-id-number"><input id="customer-id-number" placeholder="Enter ID number" {...form.register("idNumber")} className={fieldControlClass} /></FormField>
                  <FormField label="Alternative Phone (Optional)" htmlFor="customer-alt-phone"><input id="customer-alt-phone" type="tel" placeholder="Enter alternative phone number" {...form.register("alternativePhone")} className={fieldControlClass} autoComplete="tel" /></FormField>
                </>}
              </div>
            </section>
            <div className="grid content-start gap-3">
              {canReadPersonal && <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><MapPin size={17} /></span>Address Information</h3>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <FormField label="Address Line 1" htmlFor="customer-address1"><input id="customer-address1" placeholder="Enter house number, street name" {...form.register("addressLine1")} className={fieldControlClass} autoComplete="address-line1" /></FormField>
                  <FormField label="Address Line 2 (Optional)" htmlFor="customer-address2"><input id="customer-address2" placeholder="Enter apartment, suite, etc." {...form.register("addressLine2")} className={fieldControlClass} autoComplete="address-line2" /></FormField>
                  <FormField label="City / Town" htmlFor="customer-city"><input id="customer-city" placeholder="Enter city or town" {...form.register("city")} className={fieldControlClass} autoComplete="address-level2" /></FormField>
                  <FormField label="Region" htmlFor="customer-region"><select id="customer-region" {...form.register("region")} className={fieldControlClass}><option value="">Select region</option>{ghanaRegions.map((region) => <option key={region} value={region}>{region}</option>)}</select></FormField>
                  <FormField label="Country" htmlFor="customer-country"><select id="customer-country" {...form.register("country")} className={fieldControlClass}><option value="Ghana">Ghana</option></select></FormField>
                  <FormField label="GPS Location (Optional)" htmlFor="customer-gps"><div className="relative"><MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8792a0]" /><input id="customer-gps" placeholder="Enter GPS coordinates" {...form.register("gpsLocation")} className={`${fieldControlClass} pl-9`} /></div></FormField>
                </div>
              </section>}
              <section className="rounded-xl border border-[#e8edf3] bg-white p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#17212f]"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f5e3b0] text-[#795719]"><FileText size={17} /></span>Additional Information</h3>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <FormField label="Customer Type" htmlFor="customer-type" error={form.formState.errors.type?.message}><select id="customer-type" {...form.register("type")} className={fieldControlClass}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></FormField>
                  <FormField label="Status" htmlFor="customer-status"><select id="customer-status" value={editing?.isActive === false ? "ARCHIVED" : "ACTIVE"} disabled className={`${fieldControlClass} border-emerald-200 bg-emerald-50 text-emerald-700`}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></FormField>
                  {canReadPersonal && <FormField label="Notes (Optional)" htmlFor="customer-notes" error={form.formState.errors.notes?.message} className="sm:col-span-2"><textarea id="customer-notes" rows={3} placeholder="Add any additional notes about this customer…" {...form.register("notes")} className={cn(fieldControlClass, "h-auto resize-y py-3")} /></FormField>}
                </div>
              </section>
            </div>
          </div>
          {duplicates.length > 0 && <AlertDialog open title="Possible duplicate customers" variant="warning" description={`Review these profiles before continuing. You can still add this customer if they are a different person or business.\n\n${duplicates.map((duplicate) => `${duplicate.name} · ${duplicate.code} — ${duplicate.reasons.join(", ")}${duplicate.phone ? ` · ${duplicate.phone}` : ""}`).join("\n")}`} onConfirm={() => {}} />}
          <div className="customer-form-footer sticky bottom-0 z-10 -mx-5 mt-5 flex justify-between gap-2 border-t border-[#e8edf3] bg-[#fbfcfe]/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={closeForm}><X size={15} /> Cancel</Button>
            <div className="flex gap-2">
              {duplicates.length > 0 && <Button type="button" variant="outline" onClick={() => { setDuplicates([]); setDuplicateConfirmed(false); }}>Review matches first</Button>}
              <Button type="submit" variant="gold" disabled={form.formState.isSubmitting} aria-busy={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? <><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> Saving…</>
                  : duplicateConfirmed && duplicates.length
                    ? "Add as a separate customer"
                    : editing
                      ? "Save changes"
                      : <><Plus size={15} /> Save Customer</>}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>}

    <Card className="rounded-[10px]">
      <CardHeader className="gap-3 px-3 pb-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <SearchInput value={query} onChange={updateSearch} placeholder={canReadPersonal ? "Search by name, phone, email or customer ID…" : "Search by name or customer ID…"} className="[&_input]:h-9 [&_input]:text-[10px]" />
          </div>
          <CustomerListFilter label="Customer type" icon={Users} value={type} onChange={updateType} options={[["", "All Customers"], ["INDIVIDUAL", "Individuals"], ["BUSINESS", "Businesses"]]} />
          <CustomerListFilter label="Customer status" icon={CircleDot} value={status} onChange={updateStatus} options={[["ALL", "All Status"], ["ACTIVE", "Active"], ["ARCHIVED", "Archived"]]} />
          <CustomerListFilter label="Customer date range" icon={CalendarDays} value={dateRange} onChange={updateDateRange} options={[["ALL", "All Date Ranges"], ["WEEK", "This Week"], ["MONTH", "This Month"], ["LAST_30_DAYS", "Last 30 Days"], ["YEAR", "This Year"]]} />
          <Button variant="gold" size="sm" className="h-9 bg-[#f6bd2d] px-3 text-[10px] text-[#17212f] hover:bg-[#e9ae1d]" onClick={() => void load()} disabled={loading}><Filter size={13} /> Filter</Button>
          {canExport && <Button variant="outline" size="sm" className="h-9 px-2.5 text-[10px]" onClick={() => void exportCsv()} disabled={exportBusy}><Download size={13} />{exportBusy ? "Preparing…" : "Export"}</Button>}
          <Button variant="outline" size="sm" className="h-9 px-2.5 text-[10px]" onClick={resetFilters}><RotateCcw size={13} /> Reset</Button>
        </div>
        <p className="text-[10px] text-[#89929d]">{loading ? "Loading customer records…" : `${total.toLocaleString()} matching ${total === 1 ? "customer" : "customers"}`}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto px-2 pb-1">
        <table className="w-full min-w-[920px] text-left">
          <thead><tr className="border-y border-[#edf0f3] bg-[#f7f8fa] text-[9px] font-bold uppercase tracking-wide text-[#374354]">
            <th className="px-2.5 py-2.5">#</th><th className="px-2.5 py-2.5">Customer ID</th><th className="px-2.5 py-2.5">Name</th>{canReadPersonal && <><th className="px-2.5 py-2.5">Phone</th><th className="px-2.5 py-2.5">Email</th></>}{canReadTrades && <><th className="px-2.5 py-2.5">Total KG</th><th className="px-2.5 py-2.5">Total Amount (GHS)</th></>}<th className="px-2.5 py-2.5">Status</th><th className="px-2.5 py-2.5">Date Added</th><th className="px-2.5 py-2.5">Action</th>
          </tr></thead>
          <tbody>
            {loading ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="border-b border-[#f0f2f4]"><td colSpan={canReadPersonal ? (canReadTrades ? 10 : 8) : (canReadTrades ? 8 : 6)} className="px-3 py-3"><span className="block h-3 animate-pulse rounded bg-[#f0f2f4]" /></td></tr>) :
              customers.length ? customers.map((customer, index) => <tr key={customer.id} className="border-b border-[#f0f2f4] hover:bg-[#fcfbf8]">
                <td className="px-2.5 py-2 text-[9px] text-[#344151]">{(page - 1) * pageSize + index + 1}</td>
                <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[9px] text-[#536174]">{customer.code}</td>
                <td className="max-w-[130px] truncate px-2.5 py-2"><Link href={`/customers/${customer.id}`} className="text-[9px] font-semibold text-[#263341] hover:text-[#a4772c]">{customer.name}</Link><span className="block text-[8px] text-[#8994a1]">{customer.type === "BUSINESS" ? "Business" : "Individual"}</span></td>
                {canReadPersonal && <><td className="whitespace-nowrap px-2.5 py-2 text-[9px] text-[#536174]">{customer.phone || "—"}</td><td className="max-w-[155px] truncate px-2.5 py-2 text-[9px] text-[#536174]" title={customer.email ?? undefined}>{customer.email || "—"}</td></>}
                {canReadTrades && <><td className="whitespace-nowrap px-2.5 py-2 text-[9px] tabular-nums text-[#344151]">{formatWeight(customer.transactionTotals?.quantityKg ?? 0)}</td><td className="whitespace-nowrap px-2.5 py-2 text-[9px] tabular-nums text-[#344151]">{formatCurrency(customer.transactionTotals?.totalAmount ?? 0)}</td></>}
                <td className="px-2.5 py-2"><span className={cn("rounded-md px-2 py-1 text-[9px] font-semibold", customer.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{customer.isActive ? "Active" : "Archived"}</span></td>
                <td className="whitespace-nowrap px-2.5 py-2 text-[9px] text-[#536174]">{new Date(customer.createdAt).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className="relative px-2.5 py-2">
                  <div className="flex items-center gap-1">
                    {canWrite && <Button variant="outline" size="icon" className="size-7" aria-label={`Edit ${customer.name}`} title="Edit customer" onClick={() => { setOpenActionsId(null); startEdit(customer); }}><Pencil size={13} /></Button>}
                    <Button variant="outline" size="icon" className="size-7" aria-label={`Actions for ${customer.name}`} aria-expanded={openActionsId === customer.id} onClick={() => setOpenActionsId((current) => current === customer.id ? null : customer.id)}><MoreHorizontal size={14} /></Button>
                  </div>
                  {openActionsId === customer.id && <div className="absolute right-2 top-9 z-20 min-w-32 rounded-lg border border-[#e5e9ed] bg-white p-1 shadow-lg">
                    <Link href={`/customers/${customer.id}`} onClick={() => setOpenActionsId(null)} className="flex items-center gap-2 rounded px-2 py-1.5 text-[10px] text-[#344151] hover:bg-[#f7f8fa]"><Eye size={12} /> View details</Link>
                    {canWrite && <button onClick={() => { setOpenActionsId(null); startEdit(customer); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] text-[#344151] hover:bg-[#f7f8fa]"><Pencil size={12} /> Edit customer</button>}
                    {canWrite && <button onClick={() => { setOpenActionsId(null); setPendingArchive(customer); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] text-[#344151] hover:bg-[#f7f8fa]">{customer.isActive ? <X size={12} /> : <RotateCcw size={12} />}{customer.isActive ? "Archive" : "Restore"}</button>}
                  </div>}
                </td>
              </tr>) : <tr><td colSpan={canReadPersonal ? (canReadTrades ? 10 : 8) : (canReadTrades ? 8 : 6)} className="px-3 py-14 text-center"><UserRound className="mx-auto text-[#a4772c]" size={20} /><p className="mt-3 text-xs font-medium text-[#66717d]">{query ? "No customers match your search." : status === "ARCHIVED" ? "No archived customers." : "No customers have been added yet."}</p>{!query && status !== "ARCHIVED" && canWrite && <Button variant="gold" size="sm" className="mt-3" onClick={startCreate}><Plus size={14} /> Add your first customer</Button>}</td></tr>}
          </tbody>
        </table>
      </CardContent>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f3] px-3 py-2.5">
        <p className="text-[9px] text-[#89929d]">Showing {firstRow} to {lastRow} of {total.toLocaleString()} customers</p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-7" disabled={page <= 1 || loading} aria-label="Previous page" onClick={() => setPage((current) => current - 1)}>‹</Button>
          {Array.from({ length: Math.min(pageCount, 5) }, (_, index) => {
            const number = pageCount <= 5 ? index + 1 : Math.min(Math.max(1, page - 2), pageCount - 4) + index;
            return <Button key={number} variant={page === number ? "gold" : "outline"} size="icon" className={cn("size-7 text-[9px]", page === number && "bg-[#f6bd2d] text-[#17212f] hover:bg-[#e9ae1d]")} disabled={loading} aria-current={page === number ? "page" : undefined} onClick={() => setPage(number)}>{number}</Button>;
          })}
          {pageCount > 5 && <><span className="px-1 text-[10px] text-[#7f8b9a]">…</span><Button variant="outline" size="icon" className="size-7 text-[9px]" disabled={loading} onClick={() => setPage(pageCount)}>{pageCount}</Button></>}
          <Button variant="outline" size="icon" className="size-7" disabled={page >= pageCount || loading} aria-label="Next page" onClick={() => setPage((current) => current + 1)}>›</Button>
        </div>
      </div>
    </Card>

    <ConfirmDialog
      open={Boolean(pendingArchive)}
      title={pendingArchive?.isActive ? "Archive this customer?" : "Restore this customer?"}
      description={pendingArchive?.isActive
        ? `${pendingArchive.name} will no longer appear in active customer lists or new trade selection. Their purchase history, payments, and audit records will be retained.`
        : `${pendingArchive?.name} will be restored to active customer lists and new trade selection.`}
      confirmLabel={pendingArchive?.isActive ? "Archive customer" : "Restore customer"}
      destructive={Boolean(pendingArchive?.isActive)}
      busy={archiveBusy}
      onCancel={() => setPendingArchive(null)}
      onConfirm={() => { if (pendingArchive) void setArchived(pendingArchive, !pendingArchive.isActive); }}
    />
  </div>;
}

function Message({ children, onDismiss }: { tone: "error"; children: React.ReactNode; onDismiss: () => void }) {
  return <AlertDialog open title="Customer error" description={String(children)} onConfirm={onDismiss} />;
}

function SummaryCard({
  icon: Icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: typeof Users;
  tone: "purple" | "green" | "red" | "blue";
  label: string;
  value: string;
  detail: string;
}) {
  const tones = {
    purple: "bg-[#f3e9ff] text-[#8b2be8]",
    green: "bg-[#e2f8ea] text-[#18a44c]",
    red: "bg-[#ffebeb] text-[#ee4141]",
    blue: "bg-[#e7f1ff] text-[#2672e8]",
  };
  return <Card className="rounded-[10px]">
    <CardContent className="flex min-h-[88px] items-center gap-3 p-3">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-[10px] ${tones[tone]}`}><Icon size={22} strokeWidth={2.2} /></span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium text-[#617083]">{label}</p>
        <p className="mt-0.5 truncate text-[19px] font-bold leading-tight tabular-nums text-[#17212f]">{value}</p>
        <p className="mt-1 truncate text-[9px] text-[#8993a0]">{detail}</p>
      </div>
    </CardContent>
  </Card>;
}

function readError(value: unknown, fallback: string) {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : fallback;
}

function normalizePhone(value?: string) {
  const phone = value?.trim() ?? "";
  if (!phone) return "";
  const nationalNumber = phone.replace(/^\+?233\s*/, "").replace(/^0/, "").trim();
  return `+233 ${nationalNumber}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importCellValue(value: unknown, field: CustomerImportField) {
  const text = value instanceof Date
    ? field === "dateOfBirth" ? value.toISOString().slice(0, 10) : value.toISOString()
    : typeof value === "string" ? value.trim() : String(value);
  return normalizeCustomerImportValue(field, text);
}

function isCustomerImportResult(value: unknown): value is CustomerImportResult {
  return isRecord(value)
    && typeof value.imported === "number"
    && typeof value.skipped === "number"
    && Array.isArray(value.rows)
    && value.rows.every((row) => isRecord(row)
      && typeof row.rowNumber === "number"
      && ["imported", "duplicate", "invalid"].includes(String(row.status))
      && (row.reason === undefined || typeof row.reason === "string"));
}
