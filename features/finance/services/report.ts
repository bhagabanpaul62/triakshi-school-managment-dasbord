// One shape for every statement: the screen, the CSV and the PDF all read it, so a number is never worked out twice.
import { PdfBuilder } from "@smw/integrations";

export type ColumnKind = "text" | "date" | "money" | "mono";
export interface ReportColumn { key: string; label: string; kind?: ColumnKind }
export type Cell = string | number | null;
export interface ReportRow {
  /** head: a group title. sub: a subtotal. total: the grand line. */
  style?: "head" | "sub" | "total";
  cells: Record<string, Cell>;
  /** Where a cell's figure opens (the ledger, the entry). Keyed like `cells`. */
  links?: Record<string, string>;
}
export interface Report {
  title: string;
  /** Period, basis and compare line, in plain words. */
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  notes?: string[];
  /** Shown as a banner (the balance sheet does not balance). */
  warning?: string;
}

/** A text cell that Excel will not run as a formula: a leading = + - @ tab or return is defused, then it is quoted when needed. */
export function csvText(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const rupeesPlain = (paise: number) => (paise / 100).toFixed(2);

/** The cell as it goes into a CSV or PDF: money in rupees with two places, text defused only for CSV. */
function show(col: ReportColumn, v: Cell): string {
  if (v === null || v === "") return "";
  return col.kind === "money" && typeof v === "number" ? rupeesPlain(v) : String(v);
}

export function reportToCsv(r: Report): string {
  const head = [[r.title], [r.subtitle], [], r.columns.map((c) => c.label)];
  const body = r.rows.map((row) => r.columns.map((c) => show(c, row.cells[c.key] ?? null)));
  const notes = (r.notes ?? []).map((n) => [n]);
  const lines = [...head, ...body, ...(notes.length ? [[], ...notes] : [])];
  // Money cells are numbers (a leading minus is fine); only text is defused.
  return `\uFEFF${lines.map((l, i) => l.map((cell, j) => {
    const col = i >= 4 && i < 4 + body.length ? r.columns[j] : undefined;
    return col?.kind === "money" && cell !== "" ? cell : csvText(cell);
  }).join(",")).join("\r\n")}\r\n`;
}

const GREY: [number, number, number] = [0.4, 0.4, 0.45];

export async function reportToPdf(r: Report, orgName: string): Promise<Uint8Array> {
  const landscape = r.columns.length > 6;
  const pdf = await PdfBuilder.create({ unicode: true, size: landscape ? [PdfBuilder.H, PdfBuilder.W] : undefined });
  await pdf.need([orgName, r.title, r.subtitle, ...(r.notes ?? []), r.warning ?? "", ...r.columns.map((c) => c.label), ...r.rows.flatMap((row) => Object.values(row.cells).map((v) => String(v ?? "")))]);
  pdf.header({ orgName, title: r.title, rightLines: [r.subtitle] });
  if (r.warning) pdf.text(r.warning, { size: 10, bold: true, color: [0.7, 0.1, 0.1] });
  pdf.space(6);

  // Text columns share what money columns leave; money columns get a fixed width.
  const usable = pdf.right - pdf.left, moneyW = 84, dateW = 62;
  const fixed = r.columns.reduce((s, c) => s + (c.kind === "money" ? moneyW : c.kind === "date" ? dateW : 0), 0);
  const flex = r.columns.filter((c) => c.kind !== "money" && c.kind !== "date");
  const widths = r.columns.map((c) => (c.kind === "money" ? moneyW : c.kind === "date" ? dateW : (usable - fixed) / flex.length));
  const row = (cells: string[], bold: boolean) => {
    pdf.ensure(16);
    let x = pdf.left;
    cells.forEach((c, i) => {
      const w = widths[i]!, right = r.columns[i]!.kind === "money";
      let t = c;
      while (t.length > 1 && pdf.measure(t, 9, bold) > w - 8) t = t.slice(0, -1);
      if (t !== c) t = `${t.slice(0, -1)}.`;
      pdf.textAt(t, { x: right ? x + w - pdf.measure(t, 9, bold) - 4 : x + 4, y: pdf.cursor - 11, size: 9, bold });
      x += w;
    });
    pdf.cursor = pdf.cursor - 16;
  };
  row(r.columns.map((c) => c.label), true);
  pdf.rule();
  for (const line of r.rows) {
    if (line.style === "total") pdf.rule([0.5, 0.5, 0.55]);
    row(r.columns.map((c) => show(c, line.cells[c.key] ?? null)), line.style !== undefined);
  }
  pdf.rule();
  for (const n of r.notes ?? []) pdf.text(n, { size: 8, color: GREY });
  return pdf.save();
}
