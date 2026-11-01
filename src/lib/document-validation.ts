export type ReceiptMediaType = "application/pdf" | "image/jpeg" | "image/png";

export function detectReceiptMediaType(bytes: Uint8Array): ReceiptMediaType | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  return null;
}
export function safeDocumentFilename(name: string, mediaType: ReceiptMediaType): string {
  const basename = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const safe = basename.slice(-220).replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "");
  const fallback = mediaType === "application/pdf" ? "receipt.pdf" : mediaType === "image/jpeg" ? "receipt.jpg" : "receipt.png";
  return safe || fallback;
}
