"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { readSheet } from "read-excel-file/browser";
import { ArrowLeft, Download, FileSpreadsheet, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast-provider";
import { customerCsvRow } from "@/lib/customer-csv";
import {
  MANUAL_MOMO_CONTACT_IMPORT_COLUMNS,
  manualMomoContactImportFieldForHeader,
  MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS,
} from "@/lib/manual-momo-contacts";
import { manualMomoContactImportRowSchema } from "@/lib/validation";

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
type ContactForm = { name: string; phone: string; email: string; notes: string };
type ImportRow = { rowNumber: number; data: Record<string, unknown> };
type ImportResult = {
  imported: number;
  skipped: number;
  rows: { rowNumber: number; status: "imported" | "duplicate" | "invalid"; reason?: string }[];
};

const emptyForm = (): ContactForm => ({ name: "", phone: "", email: "", notes: "" });
const inputClass = "h-10 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm text-[#17212f]";

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Request failed (${response.status})`;
}

function importIssue(data: unknown) {
  const parsed = manualMomoContactImportRowSchema.safeParse(data);
  return parsed.success ? "" : [...new Set(parsed.error.issues.map((issue) => issue.message))].join("; ");
}

export function ManualMomoContacts({ canWrite }: { canWrite: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [fileName, setFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importReading, setImportReading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const { success: showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/manual-momo/contacts", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as Contact[];
      if (!Array.isArray(result)) throw new Error("The contact service returned an invalid response.");
      setContacts(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Manual Bank & MOMO contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleContacts = contacts.filter((contact) =>
    `${contact.name} ${contact.phone ?? ""} ${contact.email ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const invalidRows = importRows.flatMap((row) => {
    const reason = importIssue(row.data);
    return reason ? [{ rowNumber: row.rowNumber, reason }] : [];
  });
  const validCount = importRows.length - invalidRows.length;

  function startCreate() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
  }

  function startEdit(contact: Contact) {
    setEditing(contact);
    setForm({
      name: contact.name,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
    });
    setError("");
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(editing ? `/api/manual-momo/contacts/${editing.id}` : "/api/manual-momo/contacts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await responseError(response));
      showToast(editing ? "Manual Bank & MOMO contact updated." : "Manual Bank & MOMO contact added.");
      setEditing(null);
      setForm(emptyForm());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the contact.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteContact() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/manual-momo/contacts/${pendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      setPendingDelete(null);
      showToast("Manual Bank & MOMO contact deleted.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete the contact.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function downloadTemplate() {
    const csv = `\uFEFF${customerCsvRow(MANUAL_MOMO_CONTACT_IMPORT_COLUMNS.map(({ header }) => header))}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manual-bank-momo-contacts-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readImportFile(file: File) {
    setImportError("");
    setImportResult(null);
    setImportRows([]);
    setFileName(file.name);
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
      const columns: { index: number; field: string }[] = [];
      const foundFields = new Set<string>();
      worksheetRows[0].forEach((header, index) => {
        const field = manualMomoContactImportFieldForHeader(header);
        if (!field) return;
        if (foundFields.has(field)) throw new Error(`The worksheet has more than one column for ${field}.`);
        foundFields.add(field);
        columns.push({ index, field });
      });
      if (!foundFields.has("name")) throw new Error("The first worksheet must include a Contact Name column.");

      const parsedRows: ImportRow[] = [];
      for (let index = 1; index < worksheetRows.length; index += 1) {
        const source = worksheetRows[index];
        if (!source.some((value) => value !== null && value !== undefined && String(value).trim() !== "")) continue;
        const data: Record<string, unknown> = {};
        for (const { index: columnIndex, field } of columns) {
          const value = source[columnIndex];
          if (value !== null && value !== undefined && value !== "") data[field] = String(value).trim();
        }
        parsedRows.push({ rowNumber: index + 1, data });
        if (parsedRows.length > MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS) {
          throw new Error(`The workbook can contain at most ${MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS} contact rows.`);
        }
      }
      if (!parsedRows.length) throw new Error("The worksheet does not contain any contact rows.");
      setImportRows(parsedRows);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Unable to read the Excel workbook.");
    } finally {
      setImportReading(false);
    }
  }

  async function importContacts() {
    if (validCount === 0 || importBusy) return;
    setImportBusy(true);
    setImportError("");
    try {
      const rows = importRows.map(({ rowNumber, data }) => ({ rowNumber, data }));
      const response = await fetch("/api/manual-momo/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as ImportResult;
      setImportResult(result);
      if (result.imported > 0) showToast(`Imported ${result.imported} contact${result.imported === 1 ? "" : "s"}; skipped ${result.skipped} row${result.skipped === 1 ? "" : "s"}.`);
      await load();
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Unable to import contacts.");
    } finally {
      setImportBusy(false);
    }
  }

  function closeImport() {
    if (importBusy) return;
    setShowImport(false);
    setFileName("");
    setImportRows([]);
    setImportError("");
    setImportResult(null);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void readImportFile(file);
    event.target.value = "";
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Button asChild variant="outline" size="sm" className="mb-3"><Link href="/manual-momo"><ArrowLeft size={14} /> Manual Bank &amp; MOMO</Link></Button>
        <h1 className="text-xl font-bold text-[#17212f]">Manual Bank &amp; MOMO Contacts</h1>
        <p className="mt-1 text-sm text-[#78818d]">Manage a separate contact list for manual bank and MOMO payment records. These contacts are not added to the main customer directory.</p>
      </div>
      {canWrite && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => { setShowImport(true); setImportError(""); }}><Upload size={15} /> Import Excel</Button>
        <Button type="button" variant="gold" onClick={startCreate}><Plus size={15} /> Add contact</Button>
      </div>}
    </div>

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

    {canWrite && <Card>
      <CardHeader><CardTitle>{editing ? "Edit contact" : "Add a contact"}</CardTitle></CardHeader>
      <CardContent><form onSubmit={saveContact} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label><span className="mb-1.5 block text-xs font-medium text-[#576170]">Contact name</span><input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-xs font-medium text-[#576170]">Phone number (optional)</span><input maxLength={40} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-xs font-medium text-[#576170]">Email (optional)</span><input type="email" maxLength={254} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-xs font-medium text-[#576170]">Notes (optional)</span><input maxLength={500} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={inputClass} /></label>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="gold" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add contact"}</Button>
          {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(emptyForm()); }}><X size={14} /> Cancel</Button>}
        </div>
      </form></CardContent>
    </Card>}

    <Card>
      <CardHeader className="flex flex-wrap items-end justify-between gap-3">
        <div><CardTitle>Saved contacts</CardTitle><p className="mt-1 text-xs text-[#7c8793]">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</p></div>
        <input aria-label="Search Manual Bank & MOMO contacts" placeholder="Search contacts" value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} max-w-xs`} />
      </CardHeader>
      <CardContent>
        {loading ? <p className="py-6 text-center text-sm text-[#7c8793]">Loading contacts…</p> : <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead><tr className="border-b border-[#e7eaee] text-[10px] uppercase tracking-wide text-[#7c8793]"><th className="px-2 py-2">Name</th><th className="px-2 py-2">Phone</th><th className="px-2 py-2">Email</th><th className="px-2 py-2">Notes</th>{canWrite && <th className="px-2 py-2">Actions</th>}</tr></thead>
            <tbody>{visibleContacts.map((contact) => <tr key={contact.id} className="border-b border-[#edf0f3]">
              <td className="px-2 py-3 font-medium text-[#17212f]">{contact.name}</td><td className="px-2 py-3">{contact.phone || "—"}</td><td className="px-2 py-3">{contact.email || "—"}</td><td className="px-2 py-3">{contact.notes || "—"}</td>
              {canWrite && <td className="px-2 py-3"><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => startEdit(contact)} aria-label={`Edit ${contact.name}`}><Pencil size={13} /> Edit</Button><Button type="button" variant="danger" size="sm" onClick={() => setPendingDelete(contact)} aria-label={`Delete ${contact.name}`}><Trash2 size={13} /> Delete</Button></div></td>}
            </tr>)}
            {!visibleContacts.length && <tr><td colSpan={canWrite ? 5 : 4} className="px-2 py-8 text-center text-sm text-[#7c8793]">{contacts.length ? "No contacts match your search." : "No contacts yet. Add one or import an Excel workbook."}</td></tr>}
            </tbody>
          </table>
        </div>}
      </CardContent>
    </Card>

    {showImport && canWrite && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0c1521]/50 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImport(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-momo-contact-import-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="manual-momo-contact-import-title" className="text-xl font-bold text-[#17212f]">Import Manual Bank &amp; MOMO contacts</h2><p className="mt-1 text-sm text-[#637083]">Contact Name is required. Existing and repeated phone numbers are skipped.</p></div>
          <button type="button" onClick={closeImport} aria-label="Close contact import" disabled={importBusy} className="rounded-md p-1 text-[#74808d] hover:bg-[#f3f4f6] disabled:opacity-50"><X size={16} /></button>
        </div>
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e8edf3] bg-[#fbfcfe] p-4">
            <div className="flex items-start gap-3"><FileSpreadsheet size={19} className="mt-0.5 shrink-0 text-[#a17a35]" /><div><p className="text-sm font-semibold text-[#263241]">Use the import template</p><p className="mt-1 text-xs text-[#637083]">The CSV template opens in Excel. Save the completed workbook as .xlsx before importing; only the first worksheet is read.</p></div></div>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}><Download size={14} /> Download template</Button>
          </div>
          <label className="block rounded-xl border border-dashed border-[#cbd3dd] p-4">
            <span className="block text-sm font-semibold text-[#263241]">Choose an .xlsx workbook</span>
            <span className="mt-1 block text-xs text-[#637083]">Maximum 5 MB and {MAX_MANUAL_MOMO_CONTACT_IMPORT_ROWS} contact rows. Format phone numbers as text to preserve leading zeroes.</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-3 block w-full text-sm text-[#536174] file:mr-3 file:rounded-lg file:border-0 file:bg-[#f5e3b0] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#795719]" disabled={importReading || importBusy} onChange={handleFileChange} />
          </label>
          {fileName && <p className="text-xs text-[#536174]">Selected: {fileName}</p>}
          {importReading && <p className="text-sm text-[#637083]">Reading workbook…</p>}
          {importRows.length > 0 && !importResult && <div className="rounded-xl border border-[#e8edf3] p-3 text-sm text-[#344151]">
            Found {importRows.length} rows: {validCount} appear valid and {invalidRows.length} need correction. Existing and repeated phone numbers will be skipped.
            {invalidRows.length > 0 && <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs text-red-700">{invalidRows.slice(0, 20).map((row) => <li key={row.rowNumber}>Excel row {row.rowNumber}: {row.reason}</li>)}</ul>}
            {invalidRows.length > 20 && <p className="mt-1 text-xs text-red-700">And {invalidRows.length - 20} more rows need correction.</p>}
          </div>}
          {importResult && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Imported {importResult.imported} contact{importResult.imported === 1 ? "" : "s"}; skipped {importResult.skipped} row{importResult.skipped === 1 ? "" : "s"}.</div>}
          {importError && <p role="alert" className="text-sm text-rose-700">{importError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeImport} disabled={importBusy}>Close</Button>{!importResult && <Button type="button" variant="gold" onClick={() => void importContacts()} disabled={importBusy || importReading || validCount === 0}>{importBusy ? "Importing…" : `Import ${validCount} valid contacts`}</Button>}</div>
        </div>
      </section>
    </div>}

    <ConfirmDialog open={Boolean(pendingDelete)} title="Delete Manual Bank & MOMO contact?" description={`This will permanently remove ${pendingDelete?.name ?? "this contact"} from the separate contact list. Existing payment entries keep their recorded name and phone.`} confirmLabel="Delete contact" destructive busy={deleteBusy} onConfirm={() => void deleteContact()} onCancel={() => setPendingDelete(null)} />
  </div>;
}
