import { PdfBuilder, type Rgb } from "@smw/integrations";
import { applyHidden, copyLabels, type DocumentData, type TemplateConfig } from "./config";

export interface DocumentAssets { logo?: Uint8Array | null; signature?: Uint8Array | null }
export interface RenderOptions { assets?: DocumentAssets; /** The school's theme colour, used when the config says accent "theme". */ accent?: Rgb }

const INK: Rgb = [0.1, 0.1, 0.12], MUTED: Rgb = [0.4, 0.4, 0.45], RULE: Rgb = [0.82, 0.82, 0.85];
const A4: [number, number] = [PdfBuilder.W, PdfBuilder.H];
const SIZES = { a4: { page: A4, margin: 40, font: 10 }, a5: { page: [419.53, 595.28] as [number, number], margin: 30, font: 9 }, two_up: { page: A4, margin: 30, font: 9 }, thermal80: { page: [226.77, 6000] as [number, number], margin: 10, font: 8 } };
const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * One renderer for every document kind and layout. It draws what DocumentPaper shows, in the same order: watermark,
 * header, details, lines, totals, words, notes, terms, QR and signature, footer. Lines paginate; the HTML grows taller.
 */
export class DocumentPdf {
  private readonly cfg: TemplateConfig;
  private readonly data: DocumentData;
  private readonly accent: Rgb;
  private readonly on: (f: keyof NonNullable<TemplateConfig["showFields"]>) => boolean;

  constructor(config: TemplateConfig, data: DocumentData, private readonly opts: RenderOptions = {}) {
    this.cfg = config;
    this.data = applyHidden(config, data);
    this.accent = config.accent === "theme" ? opts.accent ?? [0.18, 0.31, 0.8] : INK;
    this.on = (f) => config.showFields?.[f] !== false;
  }

  /** Every string that will be drawn, so the right fonts are embedded before drawing starts. */
  private strings(): string[] {
    const c = this.cfg, d = this.data;
    const words = [c.title, ...c.headerLines, ...c.columns.map((x) => x.label), c.terms, c.footer, c.signature?.name, c.signature?.title, c.watermark, ...(c.copies ?? []), ...copyLabels(c)];
    return [...words, ...d.facts.flat(), ...d.rows.flatMap((r) => Object.values(r).map(cell)), ...d.totals.flatMap(([k, v]) => [k, v]), d.amountWords, ...d.notes, ...d.marks, "DUPLICATE"]
      .filter((x): x is string => !!x).flatMap((x) => [x, x.toUpperCase()]);
  }

  async render(): Promise<Uint8Array> {
    const layout = this.cfg.layout;
    if (layout === "two_up") {
      const sheet = await this.sheet("two_up");
      if (sheet) return sheet;
      // One copy does not fit half a sheet: print each copy on its own pages.
      const b = await this.builder("a4");
      const labels = copyLabels(this.cfg);
      for (let i = 0; i < labels.length; i++) {
        if (i > 0) b.pageBreak();
        await this.draw(b, labels[i]);
      }
      return b.save();
    }
    const b = await this.builder(layout);
    await this.draw(b, copyLabels(this.cfg)[0]);
    if (layout === "thermal80") b.fitHeight();
    return b.save();
  }

  private async builder(layout: keyof typeof SIZES) {
    const s = SIZES[layout];
    const b = await PdfBuilder.create({ unicode: true, size: s.page, margin: s.margin });
    await b.need(this.strings());
    // A roll has no fixed height, so its watermark sits near the top.
    const y = layout === "thermal80" ? s.page[1] - s.margin - 150 : s.page[1] / 2;
    this.watermarkAt(b, y);
    if (layout !== "thermal80") b.onPage = (p) => this.watermarkAt(p, y);
    return b;
  }

  /** Two copies stacked on one A4. Null when a copy is taller than half the sheet. */
  private async sheet(layout: "two_up"): Promise<Uint8Array | null> {
    const b = await this.builder(layout);
    const half = b.height / 2, labels = copyLabels(this.cfg);
    for (let i = 0; i < 2; i++) {
      b.frame(b.height - i * half - 8, b.height - (i + 1) * half + 8);
      await this.draw(b, labels[i]);
      if (b.overflowed) return null;
    }
    b.unframe();
    b.cursor = half;
    b.rule([0.6, 0.6, 0.65]);
    return b.save();
  }

  private watermarkAt(b: PdfBuilder, y: number) {
    const w = this.cfg.watermark;
    if (!w || !this.on("watermark")) return;
    const size = Math.min(64, (b.width * 0.8) / Math.max(w.length * 0.62, 1));
    const text = w.toUpperCase(), width = b.measure(text, size, true);
    b.textAt(text, { x: b.width / 2 - (width / 2) * Math.cos(0.45), y: y - (width / 2) * Math.sin(0.45), size, bold: true, color: [0.93, 0.93, 0.94], angle: 26 });
  }

  private async draw(b: PdfBuilder, copy?: string) {
    const c = this.cfg, d = this.data, thermal = c.layout === "thermal80", base = SIZES[c.layout].font;
    const left = b.left, width = b.right - b.left;
    await this.header(b, copy, thermal, base);
    if (this.on("facts") && d.facts.length) this.facts(b, thermal, base);
    if (this.on("table") && d.rows.length && c.columns.some((x) => x.show)) this.table(b, base);
    if (this.on("totals") && d.totals.length) this.totals(b, thermal, base);
    if (this.on("words") && d.amountWords) this.paragraph(b, d.amountWords, base, INK, 10);
    if (this.on("notes") && d.notes.length) for (const n of d.notes) this.paragraph(b, `• ${n}`, base - 0.5, MUTED, 3, 8);
    await this.closing(b, thermal, base, left, width);
  }

  private async header(b: PdfBuilder, copy: string | undefined, thermal: boolean, base: number) {
    const c = this.cfg, d = this.data;
    const [school, ...address] = c.headerLines;
    const top = b.cursor;
    const logoH = thermal ? 34 : 48;
    const stamps = this.on("marks") ? d.marks : [];
    const title = c.title.toUpperCase();
    if (thermal) {
      const mid = (b.left + b.right) / 2;
      if (this.on("logo") && this.opts.assets?.logo) {
        // image() keeps the proportions; centring needs the drawn width, so give it a square box and centre the box.
        if (await b.image(this.opts.assets.logo, { x: mid - logoH / 2, top: b.cursor, w: logoH, h: logoH, fit: true })) b.space(logoH + 4);
      }
      if (this.on("header")) {
        if (school) this.centred(b, school, base + 2, true, this.accent);
        for (const l of address) this.centred(b, l, base - 0.5, false, MUTED);
      }
      this.centred(b, title, base + 1, true, this.accent);
      if (copy) this.centred(b, copy, base - 0.5, false, MUTED);
      for (const m of stamps) this.stamp(b, m, mid - (b.measure(m.toUpperCase(), base, true) + 10) / 2, base);
      this.rule(b, 2);
      return;
    }
    let x = b.left;
    if (this.on("logo") && this.opts.assets?.logo && (await b.image(this.opts.assets.logo, { x, top, w: logoH * 2, h: logoH, fit: true }))) x += logoH * 1.4 + 8;
    // Left block: school name and address, to the right of the logo.
    const rightW = Math.min(170, (b.right - b.left) * 0.4);
    const leftW = b.right - rightW - 12 - x;
    let yl = top;
    if (this.on("header")) {
      if (school) for (const l of b.wrap(school, leftW, base + 4, true)) { b.textAt(l, { x, y: yl - (base + 4), size: base + 4, bold: true, color: this.accent }); yl -= base + 7; }
      for (const a of address) for (const l of b.wrap(a, leftW, base - 1)) { b.textAt(l, { x, y: yl - (base - 1), size: base - 1, color: MUTED }); yl -= base + 2; }
    }
    // Right block: title, copy label, stamps, all right-aligned.
    let yr = top;
    const right = (s: string, size: number, bold: boolean, color: Rgb) => {
      for (const l of b.wrap(s, rightW, size, bold)) { b.textAt(l, { x: b.right - b.measure(l, size, bold), y: yr - size, size, bold, color }); yr -= size + 3; }
    };
    right(title, base + 2, true, this.accent);
    if (copy) right(copy, base - 1, false, MUTED);
    for (const m of stamps) {
      const w = b.measure(m.toUpperCase(), base - 1, true) + 10;
      this.stamp(b, m, b.right - w, base - 1, yr);
      yr -= base + 8;
    }
    b.cursor = Math.min(yl, yr, top - (this.on("logo") && this.opts.assets?.logo ? logoH : 0)) - 6;
    this.rule(b, 2);
  }

  /** A bordered stamp such as DUPLICATE, at the cursor or at the given top. */
  private stamp(b: PdfBuilder, text: string, x: number, size: number, at?: number) {
    const top = at ?? b.cursor;
    const t = text.toUpperCase(), w = b.measure(t, size, true) + 10, h = size + 6;
    b.fill({ x, top, w, h }, INK).fill({ x: x + 1, top: top - 1, w: w - 2, h: h - 2 }, [1, 1, 1]);
    b.textAt(t, { x: x + 5, y: top - size - 2, size, bold: true });
    if (at === undefined) b.space(h + 3);
  }

  private centred(b: PdfBuilder, s: string, size: number, bold: boolean, color: Rgb) {
    for (const l of b.wrap(s, b.right - b.left, size, bold)) {
      b.ensure(size + 3);
      b.textAt(l, { x: (b.left + b.right) / 2 - b.measure(l, size, bold) / 2, y: b.cursor - size, size, bold, color });
      b.space(size + 3);
    }
  }

  private rule(b: PdfBuilder, thickness: number) {
    b.space(2).fill({ x: b.left, top: b.cursor, w: b.right - b.left, h: thickness }, this.accent).space(thickness + 8);
  }

  private facts(b: PdfBuilder, thermal: boolean, base: number) {
    const cols = thermal ? 1 : 2, gap = 14;
    const colW = (b.right - b.left - gap * (cols - 1)) / cols, labelW = colW * (thermal ? 0.4 : 0.34), valueW = colW - labelW;
    const size = base - 0.5;
    for (let i = 0; i < this.data.facts.length; i += cols) {
      const row = this.data.facts.slice(i, i + cols).map(([k, v]) => ({ k, lines: b.wrap(v, valueW, size, true), label: b.wrap(k, labelW - 4, size) }));
      const lines = Math.max(...row.map((r) => Math.max(r.lines.length, r.label.length)));
      b.ensure(lines * (size + 3));
      const top = b.cursor;
      row.forEach((r, j) => {
        const x = b.left + j * (colW + gap);
        r.label.forEach((l, n) => b.textAt(l, { x, y: top - size - n * (size + 3), size, color: MUTED }));
        r.lines.forEach((l, n) => b.textAt(l, { x: x + labelW, y: top - size - n * (size + 3), size, bold: true }));
      });
      b.cursor = top - lines * (size + 3);
    }
    b.space(4);
  }

  /** Column widths: numbers take what they need, the rest share what is left. */
  private widths(b: PdfBuilder, cols: TemplateConfig["columns"], size: number) {
    const total = b.right - b.left, pad = 12;
    const natural = cols.map((c) => Math.max(b.measure(c.label.toUpperCase(), size - 1, true), ...this.data.rows.map((r) => b.measure(cell(r[c.key]), size))) + pad);
    const fixed = cols.map((c) => c.align !== "left");
    const fixedSum = natural.reduce((s, w, i) => s + (fixed[i] ? w : 0), 0);
    const flexNat = natural.reduce((s, w, i) => s + (fixed[i] ? 0 : w), 0);
    if (!flexNat) return natural.map((w) => (w / fixedSum) * total);
    const flex = Math.max(total - fixedSum, total * 0.35);
    const scale = fixedSum + flex > total ? total / (fixedSum + flex) : 1;
    return natural.map((w, i) => (fixed[i] ? w : Math.max(flex * (w / flexNat), 50)) * scale);
  }

  private table(b: PdfBuilder, base: number) {
    const cols = this.cfg.columns.filter((c) => c.show), size = base;
    const w = this.widths(b, cols, size), lh = size + 3;
    const xs = w.map((_, i) => b.left + w.slice(0, i).reduce((s, v) => s + v, 0));
    const at = (c: (typeof cols)[number], i: number, s: string, bold: boolean, sz: number) => {
      const wd = b.measure(s, sz, bold);
      return c.align === "right" ? xs[i]! + w[i]! - wd - 6 : c.align === "center" ? xs[i]! + (w[i]! - wd) / 2 : xs[i]! + 6;
    };
    const head = () => {
      b.ensure(lh + 8);
      const top = b.cursor;
      cols.forEach((c, i) => b.textAt(c.label.toUpperCase(), { x: at(c, i, c.label.toUpperCase(), true, size - 1), y: top - size, size: size - 1, bold: true }));
      b.cursor = top - lh - 2;
      b.fill({ x: b.left, top: b.cursor, w: b.right - b.left, h: 0.8 }, INK).space(3);
    };
    b.space(6);
    head();
    for (const r of this.data.rows) {
      const cells = cols.map((c, i) => b.wrap(cell(r[c.key]), w[i]! - 12, size));
      const lines = Math.max(...cells.map((x) => x.length));
      if (b.ensure(lines * lh + 6)) head();
      const top = b.cursor;
      cells.forEach((ls, i) => ls.forEach((l, n) => b.textAt(l, { x: at(cols[i]!, i, l, false, size), y: top - size - n * lh, size })));
      b.cursor = top - lines * lh - 2;
      b.fill({ x: b.left, top: b.cursor, w: b.right - b.left, h: 0.4 }, RULE).space(3);
    }
  }

  private totals(b: PdfBuilder, thermal: boolean, base: number) {
    const bw = thermal ? b.right - b.left : (b.right - b.left) * 0.55, x = b.right - bw;
    b.space(6);
    for (const [k, v, strong] of this.data.totals) {
      const size = strong ? base + 1 : base;
      b.ensure(size + 8);
      if (strong) b.fill({ x, top: b.cursor, w: bw, h: 0.8 }, INK).space(3);
      b.textAt(k, { x: x + 6, y: b.cursor - size, size, bold: !!strong });
      b.textAt(v, { x: b.right - 6 - b.measure(v, size, !!strong), y: b.cursor - size, size, bold: !!strong });
      b.space(size + 4);
    }
  }

  private paragraph(b: PdfBuilder, s: string, size: number, color: Rgb, before: number, indent = 0) {
    b.space(before);
    for (const l of b.wrap(s, b.right - b.left - indent, size)) {
      b.ensure(size + 3);
      b.textAt(l, { x: b.left + indent, y: b.cursor - size, size, color });
      b.space(size + 3);
    }
  }

  /** Terms, QR with signature, footer. Pinned to the bottom of a single sheet, kept together when it must move. */
  private async closing(b: PdfBuilder, thermal: boolean, base: number, left: number, width: number) {
    const c = this.cfg, d = this.data;
    const terms = this.on("terms") && c.terms ? b.wrap(c.terms, width, base - 1.5) : [];
    const qr = this.on("qr") && d.qrSvg ? (thermal ? 80 : 72) : 0;
    const sig = this.on("signature") ? c.signature : null;
    const band = thermal ? (qr ? qr + 6 : 0) + (sig ? 70 : 0) : Math.max(qr, sig ? 66 : 0);
    const footer = this.on("footer") && c.footer ? b.wrap(c.footer, width, base - 1.5) : [];
    const lh = base - 1.5 + 3;
    const need = (terms.length ? terms.length * lh + 8 : 0) + (band ? band + 10 : 0) + (footer.length ? footer.length * lh + 8 : 0);
    if (!need) return;
    if (!thermal && b.cursor - need >= b.bottom) b.cursor = b.bottom + need;
    else b.ensure(need);
    for (const l of terms) { b.textAt(l, { x: left, y: b.cursor - (base - 1.5), size: base - 1.5, color: MUTED }); b.space(lh); }
    if (terms.length) b.space(8);
    if (band) {
      const top = b.cursor, mid = (b.left + b.right) / 2;
      if (thermal) {
        let y = top;
        if (qr) { b.qr(d.qrSvg!, { x: mid - qr / 2, top: y, size: qr }); y -= qr + 6; }
        if (sig) await this.signature(b, sig, y, base, mid - 70);
      } else {
        if (qr) b.qr(d.qrSvg!, { x: left, top, size: qr });
        if (sig) await this.signature(b, sig, top, base, b.right - 140);
      }
      b.cursor = top - band - 10;
    }
    for (const l of footer) {
      b.textAt(l, { x: (b.left + b.right) / 2 - b.measure(l, base - 1.5) / 2, y: b.cursor - (base - 1.5), size: base - 1.5, color: MUTED });
      b.space(lh);
    }
  }

  private async signature(b: PdfBuilder, s: NonNullable<TemplateConfig["signature"]>, top: number, base: number, x: number) {
    const w = 140;
    const img = this.opts.assets?.signature;
    if (img) await b.image(img, { x: x + w / 2 - 50, top, w: 100, h: 34, fit: true });
    const line = top - 38;
    b.fill({ x, top: line, w, h: 0.6 }, INK);
    const centre = (t: string, y: number, size: number, bold: boolean, color: Rgb) => b.textAt(t, { x: x + w / 2 - b.measure(t, size, bold) / 2, y, size, bold, color });
    centre(s.name, line - 4 - base, base, true, INK);
    if (s.title) centre(s.title, line - 8 - base * 2, base - 1, false, MUTED);
  }
}

/** The PDF for one document: same config and data as the HTML preview, with real pagination. */
export async function renderDocument(config: TemplateConfig, data: DocumentData, opts: RenderOptions = {}): Promise<Uint8Array> {
  return new DocumentPdf(config, data, opts).render();
}
