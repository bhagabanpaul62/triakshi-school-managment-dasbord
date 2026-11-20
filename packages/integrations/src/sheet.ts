import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";

export interface SheetRows {
  /** Normalised header keys: trimmed, lower case, spaces and dashes to "_" ("Admission No" -> "admission_no"). */
  columns: string[];
  /** One object per non-empty data row, every value a trimmed string ("" when blank). */
  rows: Record<string, string>[];
  /** 1-based spreadsheet line of each row (header is line 1), for error messages. */
  lines: number[];
}

export class SheetError extends Error {}

const key = (h: unknown) => String(h ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const MAX_BYTES = 5 * 1024 * 1024;

/** An Excel date cell as YYYY-MM-DD; any other cell as trimmed text. */
const text = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? "" : String(v).trim());

/**
 * Parse an uploaded .xlsx or .csv (first sheet, first row = headers) into rows of strings.
 * Both formats give identical output, so importers validate one shape.
 */
export async function parseSheet(file: { name: string; bytes: Uint8Array }): Promise<SheetRows> {
  if (file.bytes.byteLength > MAX_BYTES) throw new SheetError("The file is larger than 5 MB.");
  const isXlsx = /\.xlsx$/i.test(file.name) || (file.bytes[0] === 0x50 && file.bytes[1] === 0x4b); // zip magic "PK"
  let grid: unknown[][];
  if (isXlsx) {
    try { grid = await readSheet(Buffer.from(file.bytes)) as unknown[][]; }
    catch { throw new SheetError("That Excel file could not be read. Save it again as .xlsx or .csv."); }
  } else if (/\.(csv|txt)$/i.test(file.name) || !isXlsx) {
    const csv = new TextDecoder("utf-8").decode(file.bytes).replace(/^\uFEFF/, "");
    grid = Papa.parse<string[]>(csv, { skipEmptyLines: false }).data;
  } else {
    throw new SheetError("Upload an .xlsx or .csv file.");
  }
  const [head, ...body] = grid;
  const columns = (head ?? []).map(key);
  if (!columns.some(Boolean)) throw new SheetError("The first row must hold the column names from the template.");
  const rows: Record<string, string>[] = [];
  const lines: number[] = [];
  body.forEach((cells, i) => {
    const values = columns.map((_, c) => text(cells?.[c]));
    if (values.every((v) => v === "")) return;
    rows.push(Object.fromEntries(columns.map((c, j) => [c, values[j]!])));
    lines.push(i + 2);
  });
  return { columns, rows, lines };
}
