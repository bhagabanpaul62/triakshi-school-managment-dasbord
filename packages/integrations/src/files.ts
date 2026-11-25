import { UploadError } from "./storage";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const TEXT_SCAN = 8192;

/** True for readable UTF-8 text: no control bytes except tab, newline and return. */
function isText(b: Uint8Array) {
  const head = b.subarray(0, TEXT_SCAN);
  if (!head.length) return false;
  for (const x of head) if (x === 0 || (x < 32 && x !== 9 && x !== 10 && x !== 13)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(head.length === b.length ? head : head.subarray(0, head.length - 3)); return true; } catch { return false; }
}

/** What the bytes really are, whatever the name or the declared type says. Null when it is none of the kinds the school handles. */
export function sniffType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Office files are zips; their part names sit in plain text in the first headers.
    const names = ascii(bytes, 0, Math.min(bytes.length, 65536));
    return names.includes("word/") ? DOCX : names.includes("xl/") ? XLSX : null;
  }
  if (!isText(bytes)) return null;
  const first = new TextDecoder().decode(bytes.subarray(0, TEXT_SCAN)).split(/\r?\n/, 1)[0] ?? "";
  return /[,;\t]/.test(first) ? "text/csv" : "text/plain";
}

/**
 * Check the content of an upload against the kinds a place accepts. A name and a declared type can lie: the bytes decide.
 * Returns the real type. A text file declared as csv is accepted as csv (one column has no comma to tell).
 */
export function assertFileContent(file: { name: string; type: string; bytes: Uint8Array }, allowed: readonly string[]): string {
  const sniffed = sniffType(file.bytes);
  const real = sniffed === "text/plain" && file.type === "text/csv" ? "text/csv" : sniffed;
  const textKind = (t: string | null) => t === "text/csv" || t === "text/plain";
  if (!real || !allowed.includes(real) || (real !== file.type && !(textKind(real) && textKind(file.type)))) throw new UploadError(`${file.name} is not a kind of file this place accepts.`);
  return real;
}

const INLINE = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
/** The Content-Disposition for serving a stored file: pictures and PDFs open in the browser, everything else downloads. */
export function downloadDisposition(contentType: string, name: string): string {
  const safe = name.replace(/[\r\n"\\/]+/g, "_").slice(-120) || "file";
  const ascii7 = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${INLINE.has(contentType.toLowerCase()) ? "inline" : "attachment"}; filename="${ascii7}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
