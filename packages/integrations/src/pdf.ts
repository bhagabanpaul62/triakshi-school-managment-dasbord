import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { FontBook } from "./fonts";
import { qrCode, qrFromSvg } from "./qr";

export interface PdfHeader { title: string; orgName: string; orgLines?: string[]; rightLines?: string[] }
export interface PdfTable { columns: { label: string; width: number; align?: "left" | "right" }[]; rows: string[][] }
export type Rgb = [number, number, number];
export interface PdfOptions {
  /** Noto Sans with ₹ and the Indian scripts instead of Helvetica. Call `need()` with every string before drawing. */
  unicode?: boolean;
  /** Page size in points; default A4. */
  size?: [number, number];
  margin?: number;
}

const INK: Rgb = [0.1, 0.1, 0.12];

/**
 * One document builder for receipts, GST invoices, report cards and exports.
 * Flow layout: each call draws below the last and starts a new page when full.
 * Default fonts are the standard ones, which only cover Latin-1, so "₹" is written as "Rs." there.
 * With `unicode: true` the text is Noto Sans (₹, Hindi, Bengali, Tamil, Telugu, Kannada), shaped per script.
 */
export class PdfBuilder {
  static readonly W = 595.28;
  static readonly H = 841.89;
  static readonly M = 48;
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private fonts: FontBook | null = null;
  private y = 0;
  private pw = PdfBuilder.W;
  private ph = PdfBuilder.H;
  private m = PdfBuilder.M;
  private floor = PdfBuilder.M;
  private framed = false;
  private spilled = false;

  static async create(o: PdfOptions = {}) {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    if (o.size) [b.pw, b.ph] = o.size;
    if (o.margin !== undefined) b.m = b.floor = o.margin;
    if (o.unicode) { b.fonts = new FontBook(b.doc); await b.fonts.prepare([]); }
    else {
      b.font = await b.doc.embedFont(StandardFonts.Helvetica);
      b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    }
    b.newPage();
    return b;
  }

  /** "₹1,23,456.00" from paise. The standard-font builder prints it as "Rs. 1,23,456.00". */
  static money(paise: number) {
    return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Embed the fonts the given strings need (unicode builders only). */
  async need(texts: Iterable<string>) { await this.fonts?.prepare(texts); return this; }

  get width() { return this.pw; }
  get height() { return this.ph; }
  get left() { return this.m; }
  get right() { return this.pw - this.m; }
  get pageCount() { return this.doc.getPageCount(); }
  /** True after a framed block ran past its bottom edge. */
  get overflowed() { return this.spilled; }

  /** Runs after every page the flow adds, so a watermark or running header can be drawn on each. */
  onPage?: (b: PdfBuilder) => void;

  private newPage() { this.page = this.doc.addPage([this.pw, this.ph]); this.y = this.ph - this.m; this.onPage?.(this); }
  /** Start a new page now. */
  pageBreak() { this.newPage(); return this; }
  /** Lowest point the flow may reach on this page or frame. */
  get bottom() { return this.floor; }
  /** Make room for `h` points. Starts a new page and returns true when the page was full; inside a frame it only notes the spill. */
  ensure(h: number) {
    if (this.y - h >= this.floor) return false;
    if (this.framed) { this.spilled = true; return false; }
    this.newPage();
    return true;
  }
  /** Draw inside a fixed area (one half of a sheet): no new pages, `overflowed` says if it did not fit. */
  frame(top: number, bottom: number) { this.y = top; this.floor = bottom; this.framed = true; this.spilled = false; return this; }
  unframe() { this.floor = this.m; this.framed = false; return this; }

  private clean(s: string) { return s.replace(/₹\s?/g, "Rs. ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?"); }

  /** Width of a string in points. */
  measure(s: string, size = 10, bold = false) {
    return this.fonts ? this.fonts.width(s, size, bold) : (bold ? this.bold : this.font).widthOfTextAtSize(this.clean(s), size);
  }

  /** Break text into lines no wider than `max` points; a word longer than a line is cut. */
  wrap(s: string, max: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.measure(next, size, bold) <= max) { line = next; continue; }
        if (line) lines.push(line);
        line = "";
        let rest = word;
        while (this.measure(rest, size, bold) > max && [...rest].length > 1) {
          const chars = [...rest];
          let n = chars.length - 1;
          while (n > 1 && this.measure(chars.slice(0, n).join(""), size, bold) > max) n--;
          lines.push(chars.slice(0, n).join(""));
          rest = chars.slice(n).join("");
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draw one line with its baseline at `y` (PDF coordinates). Does not move the cursor. Returns the width. */
  textAt(s: string, o: { x: number; y: number; size?: number; bold?: boolean; color?: Rgb; angle?: number }) {
    const size = o.size ?? 10;
    if (this.fonts) return this.fonts.draw(this.page, s, { x: o.x, y: o.y, size, bold: o.bold, color: o.color ?? INK, angle: o.angle ? (o.angle * Math.PI) / 180 : 0 });
    const t = this.clean(s), f = o.bold ? this.bold : this.font;
    this.page.drawText(t, { x: o.x, y: o.y, size, font: f, color: rgb(...(o.color ?? INK)) });
    return f.widthOfTextAtSize(t, size);
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: Rgb; x?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 4);
    this.textAt(s, { x: opts.x ?? this.m, y: this.y - size, size, bold: opts.bold, color: opts.color });
    this.y -= size + (opts.gap ?? 4);
    return this;
  }

  /** Current flow position (PDF coordinates, distance from the page bottom). */
  get cursor() { return this.y; }
  set cursor(y: number) { this.y = y; }

  /**
   * Draw a PNG or JPEG with its top edge at `top` (PDF coordinates). Does not move the cursor. False if the bytes are not a readable image; never throws.
   * `fit` keeps the picture's proportions inside the box (a logo); otherwise it fills the box.
   */
  async image(bytes: Uint8Array, r: { x: number; top: number; w: number; h: number; fit?: boolean }) {
    try {
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      const img = await (png ? this.doc.embedPng(bytes) : this.doc.embedJpg(bytes));
      const k = r.fit ? Math.min(r.w / img.width, r.h / img.height) : 0;
      const [w, h] = r.fit ? [img.width * k, img.height * k] : [r.w, r.h];
      this.page.drawImage(img, { x: r.x, y: r.top - h, width: w, height: h });
      return true;
    } catch { return false; }
  }

  /**
   * A QR code, square, top edge at `top`. `source` is the text to encode, or the markup `qrSvg` made. White quiet zone included
   * in `size`. Does not move the cursor.
   */
  qr(source: string, r: { x: number; top: number; size: number }) {
    const code = source.startsWith("<svg") ? qrFromSvg(source) : qrCode(source);
    if (!code) return false;
    const quiet = 4;
    const unit = r.size / (code.size + quiet * 2);
    this.page.drawRectangle({ x: r.x, y: r.top - r.size, width: r.size, height: r.size, color: rgb(1, 1, 1) });
    for (const run of code.runs) {
      this.page.drawRectangle({ x: r.x + (run.x + quiet) * unit, y: r.top - (run.y + quiet + 1) * unit, width: run.w * unit, height: unit, color: rgb(0, 0, 0) });
    }
    return true;
  }

  /** A filled rectangle, top edge at `top`. */
  fill(r: { x: number; top: number; w: number; h: number }, color: Rgb) {
    this.page.drawRectangle({ x: r.x, y: r.top - r.h, width: r.w, height: r.h, color: rgb(...color) });
    return this;
  }

  /** An outlined box with an optional small centred label; top edge at `top`. */
  box(r: { x: number; top: number; w: number; h: number }, label?: string) {
    this.page.drawRectangle({ x: r.x, y: r.top - r.h, width: r.w, height: r.h, borderColor: rgb(0.7, 0.7, 0.74), borderWidth: 0.5 });
    if (label) this.textAt(label, { x: r.x + (r.w - this.measure(label, 7)) / 2, y: r.top - r.h / 2, size: 7, color: [0.5, 0.5, 0.55] });
    return this;
  }

  space(h = 10) { this.y -= h; return this; }

  rule(color: Rgb = [0.8, 0.8, 0.82]) {
    this.ensure(8);
    this.page.drawLine({ start: { x: this.m, y: this.y }, end: { x: this.pw - this.m, y: this.y }, thickness: 0.5, color: rgb(...color) });
    this.y -= 8;
    return this;
  }

  /** Cut the last page to the height used so far (receipt rolls). Make the page tall at `create` and call this once at the end. */
  fitHeight() {
    const h = Math.max(this.ph - this.y + this.m, 60);
    this.page.translateContent(0, -(this.ph - h));
    this.page.setSize(this.pw, h);
    return this;
  }

  header(h: PdfHeader) {
    const top = this.y;
    this.text(h.orgName, { size: 16, bold: true });
    for (const l of h.orgLines ?? []) this.text(l, { size: 9, color: [0.4, 0.4, 0.45] });
    const leftEnd = this.y;
    this.y = top;
    const rightX = this.pw - this.m - 200;
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
      if (b) { this.y = row; this.text(`${b[0]}: ${b[1]}`, { size: 9, x: this.pw / 2 }); }
    }
    return this.space(4);
  }

  table(t: PdfTable) {
    const draw = (cells: string[], bold: boolean) => {
      this.ensure(16);
      let x = this.m;
      cells.forEach((c, i) => {
        const col = t.columns[i]!;
        const w = this.measure(c, 9, bold);
        this.textAt(c, { x: col.align === "right" ? x + col.width - w - 4 : x + 4, y: this.y - 11, size: 9, bold });
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
      this.text(label, { size: 10, bold: strong, x: this.pw - this.m - 220 });
      this.y = row;
      this.text(value, { size: 10, bold: strong, x: this.pw - this.m - this.measure(value, 10, strong) });
    }
    return this;
  }

  save() { return this.doc.save(); }
}

/** Page count and first page size of a PDF; throws if the bytes are not a readable PDF. */
export async function pdfInfo(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return { pages: doc.getPageCount(), width: doc.getPage(0).getWidth(), height: doc.getPage(0).getHeight() };
}
export const pdfPageCount = async (bytes: Uint8Array) => (await pdfInfo(bytes)).pages;
