// Accession labels: a Code 128 (set B) encoder and a tiny A4 PDF writer. No libraries.

// Bar/space widths for symbol values 0..106 (106 = stop, 7 elements; the rest are 6).
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112"
).split(" ");
const START_B = 104;

/** Code 128 set B for printable ASCII. Returns the bar/space module widths, starting with a bar. */
export function code128(text: string): number[] {
  if (!text || /[^\x20-\x7E]/.test(text)) throw new Error("Code 128 B takes printable ASCII only");
  const values = [START_B, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
  return [...values, check, 106].flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** Total modules in the symbol (11 per character plus the 13-module stop). */
export const code128Modules = (text: string) => code128(text).reduce((a, b) => a + b, 0);

const W = 595.28, H = 841.89, COLS = 3, ROWS = 8, MARGIN = 18;
const CELL_W = (W - 2 * MARGIN) / COLS, CELL_H = (H - 2 * MARGIN) / ROWS;
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
const n = (x: number) => x.toFixed(2);

export interface Label { title: string; code: string }

/** An A4 sheet of 24 labels (3 x 8) per page: the title, the accession number and its Code 128 barcode. */
export function labelsPdf(labels: Label[]): Uint8Array {
  const pages: string[] = [];
  for (let p = 0; p * COLS * ROWS < Math.max(labels.length, 1); p++) {
    const ops: string[] = [];
    labels.slice(p * COLS * ROWS, (p + 1) * COLS * ROWS).forEach((l, i) => {
      const x = MARGIN + (i % COLS) * CELL_W, top = H - MARGIN - Math.floor(i / COLS) * CELL_H;
      const bars = code128(l.code);
      const mod = Math.min(1.3, (CELL_W - 24) / bars.reduce((a, b) => a + b, 0));
      const symW = bars.reduce((a, b) => a + b, 0) * mod;
      const title = clean(l.title.length > 34 ? `${l.title.slice(0, 33)}...` : l.title);
      ops.push(`0.6 w ${n(x + 4)} ${n(top - CELL_H + 4)} ${n(CELL_W - 8)} ${n(CELL_H - 8)} re S`);
      ops.push(`BT /F1 8 Tf ${n(x + 12)} ${n(top - 18)} Td (${title}) Tj ET`);
      let bx = x + (CELL_W - symW) / 2;
      bars.forEach((w, k) => { if (k % 2 === 0) ops.push(`${n(bx)} ${n(top - CELL_H + 26)} ${n(w * mod)} ${n(CELL_H - 54)} re f`); bx += w * mod; });
      ops.push(`BT /F1 10 Tf ${n(x + 12)} ${n(top - CELL_H + 12)} Td (${clean(l.code)}) Tj ET`);
    });
    pages.push(ops.join("\n"));
  }
  // objects: 1 catalog, 2 pages, 3 font, then per page a page and a content stream
  const objs: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
