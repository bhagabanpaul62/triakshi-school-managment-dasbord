"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DocumentConfig, DocumentData, DocumentField, DocumentKind, DocumentLayout } from "./document-types";

export type { DocumentConfig, DocumentData, DocumentKind, DocumentLayout } from "./document-types";

export interface DocumentPaperProps {
  config: DocumentConfig;
  data: DocumentData;
  kind: DocumentKind;
  /** "screen" is the full page, printable; "thumb" is a small, cropped, non-interactive card preview. */
  mode?: "screen" | "thumb";
  className?: string;
}

// Real proportions at 96 dpi (1 mm = 3.78 px). Height is a minimum: more rows grow the page, never clip it.
const SIZE: Record<DocumentLayout, { w: number; h: number; font: number; pad: number; mm: string }> = {
  a4: { w: 794, h: 1123, font: 13, pad: 48, mm: "210mm" },
  a5: { w: 559, h: 794, font: 12, pad: 36, mm: "148mm" },
  two_up: { w: 794, h: 1123, font: 12, pad: 36, mm: "210mm" },
  thermal80: { w: 302, h: 360, font: 11, pad: 14, mm: "80mm" },
};

const DEFAULT_TITLE: Record<DocumentKind, string> = { receipt: "Fee receipt", invoice: "Invoice", statement: "Statement of account", certificate: "Certificate", payslip: "Payslip", voucher: "Voucher" };

// Prints only the paper: everything else on the page is hidden, the paper is placed at the top left unscaled.
// shortcut: a page taller than one sheet is not split here; the PDF renderer paginates. Upgrade if screen printing of long statements is needed.
const PRINT_CSS = `@media print{body *{visibility:hidden!important}[data-fin-print],[data-fin-print] *{visibility:visible!important}[data-fin-print]{position:absolute!important;left:0!important;top:0!important;width:var(--fin-w)!important;height:auto!important;margin:0!important}[data-fin-print] [data-fin-sheet]{transform:none!important}[data-fin-thumb]{display:none!important}@page{margin:0}}`;

const on = (cfg: DocumentConfig, f: DocumentField) => cfg.showFields?.[f] !== false;

function Sheet({ config, data, kind, layout, copy, last }: { config: DocumentConfig; data: DocumentData; kind: DocumentKind; layout: DocumentLayout; copy?: string; last?: boolean }) {
  const cols = config.columns.filter((c) => c.show);
  const [school, ...address] = config.headerLines;
  const thermal = layout === "thermal80";
  const sig = config.signature;
  return (
    <section className="relative flex min-w-0 flex-col" style={{ padding: SIZE[layout].pad, minHeight: layout === "two_up" ? SIZE.two_up.h / 2 : undefined, borderBottom: layout === "two_up" && !last ? "1px dashed var(--p-rule)" : undefined }}>
      {on(config, "watermark") && config.watermark ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden text-[64px] font-bold uppercase tracking-widest opacity-[0.06]" style={{ transform: "rotate(-24deg)" }}>{config.watermark}</span>
      ) : null}

      <header className={thermal ? "text-center" : "flex items-start justify-between gap-4"} style={{ borderBottom: "2px solid var(--p-accent)", paddingBottom: 10 }}>
        <div className={thermal ? "flex flex-col items-center gap-1" : "flex min-w-0 items-start gap-3"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {on(config, "logo") && config.logoUrl ? <img src={config.logoUrl} alt="" style={{ height: thermal ? 36 : 52, width: "auto", objectFit: "contain" }} /> : null}
          {on(config, "header") ? (
            <div className="min-w-0">
              {school ? <p className="font-bold" style={{ fontSize: "1.25em", color: "var(--p-accent)" }}>{school}</p> : null}
              {address.map((l, i) => <p key={i} style={{ color: "var(--p-muted)", fontSize: "0.85em" }}>{l}</p>)}
            </div>
          ) : null}
        </div>
        <div className={thermal ? "mt-2" : "shrink-0 text-right"}>
          <h2 className="font-bold uppercase tracking-wide" style={{ fontSize: "1.1em", color: "var(--p-accent)" }}>{config.title || DEFAULT_TITLE[kind]}</h2>
          {copy ? <p style={{ color: "var(--p-muted)", fontSize: "0.85em" }}>{copy}</p> : null}
          {on(config, "marks") && data.marks.length ? (
            <p className="mt-1 flex flex-wrap gap-1" style={{ justifyContent: thermal ? "center" : "flex-end" }}>
              {data.marks.map((m) => <span key={m} className="font-bold uppercase tracking-wide" style={{ border: "1.5px solid var(--p-ink)", padding: "1px 6px", fontSize: "0.8em" }}>{m}</span>)}
            </p>
          ) : null}
        </div>
      </header>

      {on(config, "facts") && data.facts.length ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1" style={{ gridTemplateColumns: thermal ? "1fr" : "repeat(2, minmax(0, 1fr))" }}>
          {data.facts.map(([k, v], i) => (
            <div key={i} className="flex min-w-0 gap-2"><dt style={{ color: "var(--p-muted)", minWidth: thermal ? "40%" : "34%" }}>{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></div>
          ))}
        </dl>
      ) : null}

      {on(config, "table") && cols.length && data.rows.length ? (
        <table className="mt-4 w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>{cols.map((c) => <th key={c.key} scope="col" style={{ textAlign: c.align, padding: "4px 6px", borderBottom: "1px solid var(--p-ink)", fontSize: "0.85em" }} className="font-semibold uppercase">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.key} style={{ textAlign: c.align, padding: "4px 6px", borderBottom: "1px solid var(--p-rule)", fontVariantNumeric: "tabular-nums" }}>{r[c.key] ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {on(config, "totals") && data.totals.length ? (
        <dl className="mt-3 ml-auto" style={{ width: thermal ? "100%" : "55%" }}>
          {data.totals.map(([k, v, strong], i) => (
            <div key={i} className="flex justify-between gap-3" style={{ padding: "2px 6px", fontWeight: strong ? 700 : 400, borderTop: strong ? "1px solid var(--p-ink)" : undefined, fontSize: strong ? "1.1em" : undefined }}>
              <dt>{k}</dt><dd className="tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {on(config, "words") && data.amountWords ? <p className="mt-3 italic">{data.amountWords}</p> : null}
      {on(config, "notes") && data.notes.length ? <ul className="mt-3 list-disc pl-5" style={{ color: "var(--p-muted)", fontSize: "0.9em" }}>{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}

      <div className="flex-1" />
      {on(config, "terms") && config.terms ? <p className="mt-4 whitespace-pre-line" style={{ color: "var(--p-muted)", fontSize: "0.8em" }}>{config.terms}</p> : null}

      <div className="mt-4 flex items-end justify-between gap-4">
        {on(config, "qr") && data.qrSvg ? (
          // an <img> never runs scripts, so the SVG text cannot execute even if it were not ours
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(data.qrSvg)}`} alt="QR code" style={{ width: thermal ? 96 : 84, height: thermal ? 96 : 84 }} />
        ) : <span />}
        {on(config, "signature") && sig ? (
          <div className="text-center" style={{ minWidth: 140 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sig.imageUrl ? <img src={sig.imageUrl} alt="" style={{ height: 40, margin: "0 auto", objectFit: "contain" }} /> : <div style={{ height: 40 }} />}
            <p style={{ borderTop: "1px solid var(--p-ink)", paddingTop: 2 }} className="font-medium">{sig.name}</p>
            <p style={{ color: "var(--p-muted)", fontSize: "0.85em" }}>{sig.title}</p>
          </div>
        ) : null}
      </div>
      {on(config, "footer") && config.footer ? <p className="mt-3 text-center" style={{ color: "var(--p-muted)", fontSize: "0.8em" }}>{config.footer}</p> : null}
    </section>
  );
}

/** A document as white paper on the dark page: same config and data the PDF uses. Scales down to its container, prints alone. */
export function DocumentPaper({ config, data, kind, mode = "screen", className }: DocumentPaperProps) {
  const layout = config.layout;
  const size = SIZE[layout];
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(size.h);

  useLayoutEffect(() => {
    const b = box.current;
    const s = sheet.current;
    if (!b || !s) return;
    const measure = () => { setScale(Math.min(1, b.clientWidth / size.w)); setHeight(Math.max(s.offsetHeight, 1)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(s);
    return () => ro.disconnect();
  }, [size.w]);

  const vars = {
    "--fin-w": size.mm,
    "--p-ink": "var(--ds-color-neutral-900)",
    "--p-muted": "var(--ds-color-neutral-500)",
    "--p-rule": "var(--ds-color-neutral-200)",
    "--p-accent": config.accent === "theme" ? "var(--ds-color-primary-600)" : "var(--ds-color-neutral-900)",
  } as CSSProperties;
  const copies = config.copies ?? [];
  const thumb = mode === "thumb";

  return (
    <div ref={box} className={className} data-fin-thumb={thumb ? "" : undefined}>
      <style>{PRINT_CSS}</style>
      <div
        data-fin-print={thumb ? undefined : ""}
        role={thumb ? "img" : "document"}
        aria-label={`${config.title || DEFAULT_TITLE[kind]} preview`}
        className="mx-auto overflow-hidden rounded-sm shadow-lg"
        style={{ ...vars, width: size.w * scale, height: (thumb ? Math.min(height, size.w * 0.9) : height) * scale }}
      >
        <div
          ref={sheet}
          data-fin-sheet=""
          aria-hidden={thumb ? true : undefined}
          style={{ width: size.w, minHeight: size.h, transform: `scale(${scale})`, transformOrigin: "top left", background: "var(--ds-color-neutral-50)", color: "var(--p-ink)", fontSize: size.font, lineHeight: 1.4, pointerEvents: thumb ? "none" : undefined }}
        >
          {layout === "two_up" ? (
            <>
              <Sheet config={config} data={data} kind={kind} layout={layout} copy={copies[0]} />
              <Sheet config={config} data={data} kind={kind} layout={layout} copy={copies[1]} last />
            </>
          ) : (
            <Sheet config={config} data={data} kind={kind} layout={layout} copy={copies[0]} last />
          )}
        </div>
      </div>
    </div>
  );
}
