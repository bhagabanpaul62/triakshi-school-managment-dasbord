import qrcode from "qrcode-generator";

/** One horizontal run of dark modules: `w` modules starting at column `x` of row `y`. */
export interface QrRun { x: number; y: number; w: number }
export interface QrCode { size: number; runs: QrRun[] }

/** A QR code as runs of dark modules, with no quiet zone. Level M: survives a scuffed print. */
export function qrCode(text: string): QrCode {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  const size = q.getModuleCount();
  const runs: QrRun[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!q.isDark(y, x)) continue;
      let w = 1;
      while (x + w < size && q.isDark(y, x + w)) w++;
      runs.push({ x, y, w });
      x += w;
    }
  }
  return { size, runs };
}

/** Inline SVG markup (one path, 4 modules of quiet zone) that scales to any size. */
export function qrSvg(text: string): string {
  const { size, runs } = qrCode(text);
  const total = size + 8;
  const d = runs.map((r) => `M${r.x + 4} ${r.y + 4}h${r.w}v1h-${r.w}z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Read back a code made by `qrSvg` (the PDF draws the same markup the screen shows). Null for any other SVG. */
export function qrFromSvg(svg: string): QrCode | null {
  const box = /viewBox="0 0 (\d+) \1"/.exec(svg);
  if (!box) return null;
  const runs = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)].map((m) => ({ x: Number(m[1]) - 4, y: Number(m[2]) - 4, w: Number(m[3]) }));
  return { size: Number(box[1]) - 8, runs };
}

export interface UpiLink { upiId: string; name: string; amountPaise: number; note?: string; ref?: string }

/** `upi://pay?...` deep link (NPCI spec): exact amount in rupees, payee name, note and a reference the bank statement will show. */
export function upiUri({ upiId, name, amountPaise, note, ref }: UpiLink): string {
  if (!/^[\w.-]{2,}@[a-z][a-z0-9]+$/i.test(upiId)) throw new Error("That is not a UPI ID.");
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error("The amount must be a whole number of paise above zero.");
  const rupees = `${Math.trunc(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, "0")}`;
  // %20 for spaces (some UPI apps read "+" literally), & = ? # escaped in names and notes, "@" kept as the apps expect.
  const q = (k: string, v: string) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`;
  return `upi://pay?${[q("pa", upiId), q("pn", name), q("am", rupees), q("cu", "INR"), ...(note ? [q("tn", note)] : []), ...(ref ? [q("tr", ref)] : [])].join("&")}`;
}
