// regenerator-runtime: fontkit 1.1.1 ships generator code that needs this global, and without it every Indic script throws.
import "regenerator-runtime/runtime.js";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFHexString, type PDFName, beginText, endText, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize, setTextMatrix, showText, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

export type FontScript = "latin" | "devanagari" | "bengali" | "tamil" | "telugu" | "kannada";

/**
 * Scripts whose conjuncts and marks were checked by eye on a rendered page (see fonts.test.ts and the report).
 * A script not listed prints "?" for its letters instead of broken shapes.
 */
export const ENABLED_SCRIPTS: readonly FontScript[] = ["latin", "devanagari", "bengali", "tamil", "telugu", "kannada"];

// [first, last] code points of each Indic block; everything else is Latin.
const BLOCKS: [Exclude<FontScript, "latin">, number, number][] = [
  ["devanagari", 0x0900, 0x097f], ["devanagari", 0xa8e0, 0xa8ff], ["bengali", 0x0980, 0x09ff],
  ["tamil", 0x0b80, 0x0bff], ["telugu", 0x0c00, 0x0c7f], ["kannada", 0x0c80, 0x0cff],
];
const JOINERS = new Set([0x200c, 0x200d]);

type FaceId = FontScript | "latinExt";
/** Fontsource package, and the unicode-range subset file that holds the script's own letters. */
const FILES: Record<FaceId, [pkg: string, subset: string]> = {
  latin: ["noto-sans", "latin"], latinExt: ["noto-sans", "latin-ext"],
  devanagari: ["noto-sans-devanagari", "devanagari"], bengali: ["noto-sans-bengali", "bengali"],
  tamil: ["noto-sans-tamil", "tamil"], telugu: ["noto-sans-telugu", "telugu"], kannada: ["noto-sans-kannada", "kannada"],
};

const dirs = new Map<string, string>();
/** `node_modules/@fontsource/<pkg>/files`: through node resolution in dev and tests, through the traced pnpm folder in the standalone build. */
function fontDir(pkg: string): string {
  const hit = dirs.get(pkg);
  if (hit) return hit;
  let dir: string | undefined;
  try { dir = join(dirname(createRequire(import.meta.url).resolve(`@fontsource/${pkg}/package.json`)), "files"); } catch { /* bundled: fall through */ }
  if (!dir) {
    const store = join(/* turbopackIgnore: true */ process.cwd(), "../../node_modules/.pnpm");
    const name = readdirSync(/* turbopackIgnore: true */ store).find((d) => d.startsWith(`@fontsource+${pkg}@`));
    if (!name) throw new Error(`Font package @fontsource/${pkg} is missing from the build. Add it to outputFileTracingIncludes.`);
    dir = join(store, name, "node_modules/@fontsource", pkg, "files");
  }
  dirs.set(pkg, dir);
  return dir;
}

/** WOFF 1 to plain TrueType: PDF viewers cannot read a WOFF file embedded as a font. */
function unwoff(w: Buffer): Buffer<ArrayBuffer> {
  const n = w.readUInt16BE(12);
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(w.readUInt32BE(4), 0);
  head.writeUInt16BE(n, 4);
  const range = 2 ** Math.floor(Math.log2(n));
  head.writeUInt16BE(range * 16, 6); head.writeUInt16BE(Math.log2(range), 8); head.writeUInt16BE(n * 16 - range * 16, 10);
  const parts = [head];
  let pos = head.length;
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20, offset = w.readUInt32BE(o + 4), comp = w.readUInt32BE(o + 8), orig = w.readUInt32BE(o + 12);
    const data = comp < orig ? inflateSync(w.subarray(offset, offset + comp)) : Buffer.from(w.subarray(offset, offset + orig));
    const at = 12 + i * 16;
    w.copy(head, at, o, o + 4); head.writeUInt32BE(w.readUInt32BE(o + 16), at + 4); head.writeUInt32BE(pos, at + 8); head.writeUInt32BE(orig, at + 12);
    const pad = (4 - (data.length % 4)) % 4;
    parts.push(data, Buffer.alloc(pad));
    pos += data.length + pad;
  }
  return Buffer.concat(parts) as Buffer<ArrayBuffer>;
}

interface Loaded { bytes: Uint8Array; fk: fontkit.Font }
const loaded = new Map<string, Loaded>();
/** Parsed once per process; every PDF embeds from the same bytes. */
function load(face: FaceId, bold: boolean): Loaded {
  const [pkg, subset] = FILES[face];
  const file = join(fontDir(pkg), `${pkg}-${subset}-${bold ? 700 : 400}-normal.woff`);
  let l = loaded.get(file);
  if (!l) {
    const bytes = unwoff(readFileSync(/* turbopackIgnore: true */ file));
    l = { bytes, fk: fontkit.create(bytes) as fontkit.Font };
    loaded.set(file, l);
  }
  return l;
}

/** Which script a code point belongs to; null for joiners, which stay with the letters before them. */
export function scriptOf(cp: number): FontScript | null {
  if (JOINERS.has(cp)) return null;
  return BLOCKS.find(([, a, b]) => cp >= a && cp <= b)?.[0] ?? "latin";
}

interface Run { face: FaceId; text: string }

/** Split text into runs that each use one font. Letters of a disabled script, or in no font, become "?". */
export function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  const add = (face: FaceId, s: string) => {
    const last = runs[runs.length - 1];
    if (last && last.face === face) last.text += s; else runs.push({ face, text: s });
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const script = scriptOf(cp);
    if (script === null) { const last = runs[runs.length - 1]; if (last && last.face !== "latin" && last.face !== "latinExt") last.text += ch; continue; }
    if (script !== "latin") {
      if (ENABLED_SCRIPTS.includes(script) && load(script, false).fk.hasGlyphForCodePoint(cp)) add(script, ch); else add("latin", "?");
      continue;
    }
    if (cp < 0x20 || cp === 0x7f) continue;
    if (load("latin", false).fk.hasGlyphForCodePoint(cp)) add("latin", ch);
    else if (load("latinExt", false).fk.hasGlyphForCodePoint(cp)) add("latinExt", ch);
    else add("latin", "?");
  }
  return runs;
}

interface Glyph { code: string; x: number; y: number }
interface Shaped { glyphs: Glyph[]; width: number }

/** fontkit cannot subset Noto Telugu, so it goes in whole (about 125 KB a weight). Bold text in Telugu uses the regular weight rather than adding a second copy. */
const TELUGU_ONE_WEIGHT: FaceId = "telugu";
type Laid = ReturnType<fontkit.Font["layout"]>;
/** fontkit 1.1.1 crashes on a missing mark anchor in some Telugu conjuncts (శ్రీ, ప్రి). Without these two position features the run still shapes. */
const SAFE = { abvm: false, blwm: false };

/**
 * Fonts for one PDF. pdf-lib asks fontkit to choose glyphs but throws away where a mark sits on its base letter, so
 * Bengali dots and Indic vowel signs land beside the letter. We shape with fontkit ourselves and put every glyph at the
 * position it asked for.
 */
export class FontBook {
  private fonts = new Map<string, PDFFont>();
  private cache = new Map<string, { laid: Laid; safe: boolean }>();

  constructor(private readonly doc: PDFDocument) { doc.registerFontkit(fontkit); }

  private layout(run: Run, bold: boolean) {
    bold = bold && run.face !== TELUGU_ONE_WEIGHT;
    const key = `${run.face}:${bold}:${run.text}`;
    let hit = this.cache.get(key);
    if (!hit) {
      const { fk } = load(run.face, bold);
      try { hit = { laid: fk.layout(run.text), safe: false }; } catch { hit = { laid: fk.layout(run.text, SAFE as never), safe: true }; }
      this.cache.set(key, hit);
    }
    return hit;
  }

  /** Embed (as a subset) every font this text needs. Drawing a face that was not prepared throws. */
  async prepare(texts: Iterable<string>) {
    const need = new Map<string, [FaceId, boolean, boolean]>([["latin:false:false", ["latin", false, false]], ["latin:true:false", ["latin", true, false]], ["latinExt:false:false", ["latinExt", false, false]], ["latinExt:true:false", ["latinExt", true, false]]]);
    for (const t of texts) for (const r of runsOf(t)) for (const bold of [false, true]) {
      const safe = this.layout(r, bold).safe, b = bold && r.face !== TELUGU_ONE_WEIGHT;
      need.set(`${r.face}:${b}:${safe}`, [r.face, b, safe]);
    }
    for (const [key, [face, bold, safe]] of need) {
      if (!this.fonts.has(key)) this.fonts.set(key, await this.doc.embedFont(load(face, bold).bytes, { subset: face !== "telugu", features: safe ? SAFE : undefined }));
    }
  }

  private keys = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();
  /** The name a page uses for a font in its resources, made once per page. */
  private key(page: PDFPage, font: PDFFont) {
    const m = this.keys.get(page) ?? new Map<PDFFont, PDFName>();
    this.keys.set(page, m);
    let k = m.get(font);
    if (!k) { k = page.node.newFontDictionary(font.name, font.ref); m.set(font, k); }
    return k;
  }

  private font(run: Run, bold: boolean) {
    bold = bold && run.face !== TELUGU_ONE_WEIGHT;
    const f = this.fonts.get(`${run.face}:${bold}:${this.layout(run, bold).safe}`);
    if (!f) throw new Error(`Font ${run.face} was not prepared: call prepare() with the text first.`);
    return f;
  }

  private shape(run: Run, bold: boolean, size: number): Shaped {
    bold = bold && run.face !== TELUGU_ONE_WEIGHT;
    const pdfFont = this.font(run, bold);
    const { laid } = this.layout(run, bold);
    // encodeText registers the same glyph sequence in the subset and returns one 4-digit code per glyph.
    const hex = pdfFont.encodeText(run.text).toString().slice(1, -1);
    const k = size / load(run.face, bold).fk.unitsPerEm;
    let x = 0;
    const glyphs = laid.glyphs.map((_, i) => {
      const p = laid.positions[i]!;
      const g = { code: hex.slice(i * 4, i * 4 + 4), x: x + p.xOffset * k, y: p.yOffset * k };
      x += p.xAdvance * k;
      return g;
    });
    return { glyphs, width: x };
  }

  width(text: string, size: number, bold = false) {
    return runsOf(text).reduce((w, r) => w + this.layout(r, bold).laid.positions.reduce((a, p) => a + p.xAdvance, 0) * size / load(r.face, bold && r.face !== TELUGU_ONE_WEIGHT).fk.unitsPerEm, 0);
  }

  /** Draw one line with its baseline at `y`. Returns the width. */
  draw(page: PDFPage, text: string, o: { x: number; y: number; size: number; bold?: boolean; color: [number, number, number]; angle?: number }) {
    const bold = !!o.bold;
    const cos = Math.cos(o.angle ?? 0), sin = Math.sin(o.angle ?? 0);
    let x = 0;
    for (const run of runsOf(text)) {
      const s = this.shape(run, bold, o.size);
      const key = this.key(page, this.font(run, bold));
      page.pushOperators(
        pushGraphicsState(), setFillingColor(rgb(...o.color)), beginText(), setFontAndSize(key, o.size),
        ...s.glyphs.flatMap((g) => [setTextMatrix(cos, sin, -sin, cos, o.x + cos * (x + g.x) - sin * g.y, o.y + sin * (x + g.x) + cos * g.y), showText(PDFHexString.of(g.code))]),
        endText(), popGraphicsState(),
      );
      x += s.width;
    }
    return x;
  }
}
