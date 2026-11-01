export type ExcelSheet = { name: string; rows: Array<Array<string | number | boolean | null>> };

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function cell(value: string | number | boolean | null, header = false) {
  const type = typeof value === "boolean" ? "Boolean" : typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
  const text = value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  return `<Cell${header ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${type}">${escapeXml(text)}</Data></Cell>`;
}

export function buildExcelWorkbook(sheets: ExcelSheet[]) {
  const sheetXml = sheets.map((sheet) => {
    const name = sheet.name.slice(0, 31).replace(/[\[\]:*?/\\]/g, " ");
    const rows = sheet.rows.map((row, index) =>
      `<Row>${row.map((value) => cell(value, index === 0)).join("")}</Row>`,
    ).join("");
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows}</Table></Worksheet>`;
  }).join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#F7F0E3" ss:Pattern="Solid"/></Style></Styles>
${sheetXml}
</Workbook>`;
}

export function downloadExcelWorkbook(filename: string, sheets: ExcelSheet[]) {
  const blob = new Blob([buildExcelWorkbook(sheets)], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
