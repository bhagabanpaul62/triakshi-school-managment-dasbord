// A small, safe markdown subset. Output is an AST, never HTML, so a renderer cannot be tricked into running anything.
// Supported: paragraphs, # ## ### headings, **bold**, *italic*, "- " and "1. " lists, [text](url) with http/https/mailto/tel, bare URLs.
// Everything else stays literal text.

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] };
export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] };

/** shortcut: input beyond 100k characters is ignored, a notice is not a book. */
const MAX_INPUT = 100_000;
const MAX_DEPTH = 3;
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)[^\s<>"'`]+$/i;
const isSafeUrl = (u: string) => SAFE_URL.test(u) && !/^https?:\/\/$/i.test(u);

function parseInline(s: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  // Once a closer is missing it is missing for the rest of the text: no rescans, so unmatched markers stay linear.
  let noBold = false, noItalic = false, noBracket = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "[" && links && !noBracket) {
      const close = s.indexOf("](", i + 1);
      const end = close < 0 ? -1 : s.indexOf(")", close + 2);
      if (close < 0 || end < 0) noBracket = true;
      else {
        const url = s.slice(close + 2, end).trim();
        const label = s.slice(i + 1, close);
        if (label && !label.includes("[") && isSafeUrl(url)) {
          flush();
          out.push({ t: "a", href: url, c: depth < MAX_DEPTH ? parseInline(label, depth + 1, false) : [{ t: "text", v: label }] });
          i = end + 1;
          continue;
        }
      }
    } else if (ch === "*" && depth < MAX_DEPTH) {
      if (s[i + 1] === "*" && !noBold) {
        const end = s.indexOf("**", i + 2);
        if (end < 0) noBold = true;
        else if (end > i + 2) { flush(); out.push({ t: "b", c: parseInline(s.slice(i + 2, end), depth + 1, links) }); i = end + 2; continue; }
      } else if (s[i + 1] !== "*" && s[i + 1] !== " " && !noItalic) {
        let end = s.indexOf("*", i + 1);
        while (end > 0 && s[end + 1] === "*" && s[end - 1] !== "*") end = s.indexOf("*", end + 2);
        if (end < 0) noItalic = true;
        else if (end > i + 1 && s[end - 1] !== " ") { flush(); out.push({ t: "i", c: parseInline(s.slice(i + 1, end), depth + 1, links) }); i = end + 1; continue; }
      }
    } else if (links && (ch === "h" || ch === "H") && /^https?:\/\//i.test(s.slice(i, i + 8)) && (i === 0 || /[\s(]/.test(s[i - 1]!))) {
      let end = i;
      while (end < s.length && !/[\s<>"']/.test(s[end]!)) end++;
      while (end > i && /[.,;:!?)\]]/.test(s[end - 1]!)) end--;
      const url = s.slice(i, end);
      if (isSafeUrl(url)) { flush(); out.push({ t: "a", href: url, c: [{ t: "text", v: url }] }); i = end; continue; }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const lines = (md ?? "").slice(0, MAX_INPUT).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join("\n")) }); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = /^(#{1,3}) +(\S.*)$/.exec(line);
    const li = /^(?:([-•]) +|(\d{1,3})[.)] +)(\S.*)$/.exec(line);
    if (!line.trim()) endPara();
    else if (h) { endPara(); blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!) }); }
    else if (li) {
      endPara();
      const kind = li[1] ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      const item = parseInline(li[3]!);
      if (last && last.t === kind) last.items.push(item); else blocks.push({ t: kind, items: [item] });
    } else para.push(line);
  }
  endPara();
  return blocks;
}

const inlineText = (c: Inline[]): string => c.map((n) => (n.t === "text" ? n.v : n.t === "a" ? (n.c.length === 1 && n.c[0]!.t === "text" && n.c[0]!.v === n.href ? n.href : `${inlineText(n.c)} (${n.href})`) : inlineText(n.c))).join("");

/** Plain text for previews, emails and PDFs: markers gone, links as "text (url)", blocks separated by a blank line. Cut at `max` characters with an ellipsis. */
export function markdownToText(md: string, max?: number): string {
  const text = parseMarkdown(md).map((b) =>
    b.t === "p" || b.t === "h" ? inlineText(b.c) : b.items.map((it, n) => `${b.t === "ul" ? "-" : `${n + 1}.`} ${inlineText(it)}`).join("\n"),
  ).join("\n\n");
  if (max === undefined || Array.from(text).length <= max) return text;
  return Array.from(text).slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const inlineHtml = (c: Inline[]): string => c.map((n) =>
  n.t === "text" ? esc(n.v).replace(/\n/g, "<br>")
  : n.t === "b" ? `<strong>${inlineHtml(n.c)}</strong>`
  : n.t === "i" ? `<em>${inlineHtml(n.c)}</em>`
  : `<a href="${esc(n.href)}" rel="noopener noreferrer">${inlineHtml(n.c)}</a>`).join("");

/** HTML for emails only (the web renders the AST). Every character of text and every URL is escaped. */
export function markdownToHtml(md: string): string {
  return parseMarkdown(md).map((b) =>
    b.t === "p" ? `<p>${inlineHtml(b.c)}</p>`
    : b.t === "h" ? `<h${b.level + 1}>${inlineHtml(b.c)}</h${b.level + 1}>`
    : `<${b.t}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${b.t}>`).join("");
}
