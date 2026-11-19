import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfHeader { title: string; orgName: string; orgLines?: string[]; rightLines?: string[] }
export interface PdfTable { columns: { label: string; width: number; align?: "left" | "right" }[]; rows: string[][] }

/**
 * One A4 document builder for receipts, GST invoices, report cards and exports.
 * Flow layout: each call draws below the last and starts a new page when full.
 * Standard fonts only cover Latin-1, so "₹" is written as "Rs." (see `money`).
 */
export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  static readonly W = 595.28;
  static readonly H = 841.89;
  static readonly M = 48;

  static async create() {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    b.font = await b.doc.embedFont(StandardFonts.Helvetica);
    b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.newPage();
    return b;
  }

  /** "Rs. 1,23,456.00" from paise. */
  static money(paise: number) {
    return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private newPage() { this.page = this.doc.addPage([PdfBuilder.W, PdfBuilder.H]); this.y = PdfBuilder.H - PdfBuilder.M; }
  private ensure(h: number) { if (this.y - h < PdfBuilder.M) this.newPage(); }
  private clean(s: string) { return s.replace(/₹/g, "Rs.").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?"); }

  text(s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(this.clean(s), { x: opts.x ?? PdfBuilder.M, y: this.y - size, size, font: opts.bold ? this.bold : this.font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])) });
    this.y -= size + (opts.gap ?? 4);
    return this;
  }

  space(h = 10) { this.y -= h; return this; }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: PdfBuilder.M, y: this.y }, end: { x: PdfBuilder.W - PdfBuilder.M, y: this.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.82) });
    this.y -= 8;
    return this;
  }

  header(h: PdfHeader) {
    const top = this.y;
    this.text(h.orgName, { size: 16, bold: true });
    for (const l of h.orgLines ?? []) this.text(l, { size: 9, color: [0.4, 0.4, 0.45] });
    const leftEnd = this.y;
    this.y = top;
    const rightX = PdfBuilder.W - PdfBuilder.M - 200;
    this.text(h.title, { size: 14, bold: true, x: rightX });
    for (const l of h.rightLines ?? []) this.text(l, { size: 9, x: rightX });
    this.y = Math.min(leftEnd, this.y) - 6;
    return this.rule();
  }

  /** Label/value pairs in two columns. */
  facts(pairs: [string, string][]) {
    for (let i = 0; i < pairs.length; i += 2) {
      const row = this.y;
      const [a, b] = [pairs[i]!, pairs[i + 1]];
      this.text(`${a[0]}: ${a[1]}`, { size: 9 });
      if (b) { this.y = row; this.text(`${b[0]}: ${b[1]}`, { size: 9, x: PdfBuilder.W / 2 }); }
    }
    return this.space(4);
  }

  table(t: PdfTable) {
    const draw = (cells: string[], bold: boolean) => {
      this.ensure(16);
      let x = PdfBuilder.M;
      cells.forEach((c, i) => {
        const col = t.columns[i]!;
        const s = this.clean(c);
        const f = bold ? this.bold : this.font;
        const w = f.widthOfTextAtSize(s, 9);
        this.page.drawText(s, { x: col.align === "right" ? x + col.width - w - 4 : x + 4, y: this.y - 11, size: 9, font: f });
        x += col.width;
      });
      this.y -= 16;
    };
    draw(t.columns.map((c) => c.label), true);
    this.rule();
    for (const r of t.rows) draw(r, false);
    return this.rule();
  }

  /** Right-aligned totals block. */
  totals(lines: [string, string, boolean?][]) {
    for (const [label, value, strong] of lines) {
      const row = this.y;
      this.text(label, { size: 10, bold: strong, x: PdfBuilder.W - PdfBuilder.M - 220 });
      this.y = row;
      const f = strong ? this.bold : this.font;
      const s = this.clean(value);
      this.text(s, { size: 10, bold: strong, x: PdfBuilder.W - PdfBuilder.M - f.widthOfTextAtSize(s, 10) });
    }
    return this;
  }

  save() { return this.doc.save(); }
}
