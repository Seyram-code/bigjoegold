export function customerCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function customerCsvRow(values: unknown[]): string {
  return values.map(customerCsvCell).join(",");
}
