// How a module's own route hands a private file, PDF or spreadsheet to the browser. One place, so the headers never drift.
import { downloadDisposition } from "./files";

const PRIVATE = { "cache-control": "private, no-store" };

/** A stored file: pictures and PDFs open in the browser, anything else downloads, and the browser may not guess another type. */
export const fileResponse = (f: { bytes: Uint8Array; type: string; name: string }) => new Response(Buffer.from(f.bytes), {
  headers: { "content-type": f.type, "content-disposition": downloadDisposition(f.type, f.name), "x-content-type-options": "nosniff", ...PRIVATE },
});

export const pdfResponse = (bytes: Uint8Array, fileName: string) => new Response(Buffer.from(bytes), {
  headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, ...PRIVATE },
});

/** One CSV cell. A cell that starts like a formula gets an apostrophe so a spreadsheet never runs it. */
export const csvCell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const csvLine = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
export const csvText = (rows: unknown[][]) => rows.map(csvLine).join("");

/** A CSV download; the byte-order mark makes Excel read Hindi and other names right. */
export const csvResponse = (csv: string, fileName: string) => new Response(`\uFEFF${csv}`, {
  headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, ...PRIVATE },
});

/** A title as a file-name part: "Half-yearly exam!" becomes "half-yearly-exam". */
export const slugOf = (title: string, fallback: string, max = 40) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max).replace(/-$/, "") || fallback;
