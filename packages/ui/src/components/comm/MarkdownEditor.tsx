"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconBold, IconHeading, IconItalic, IconLink, IconList, IconListNumbers, type Icon } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { INPUT } from "../../lib/tone";
import { FOCUS, ICON_BTN } from "../finance/ui";
import { Markdown } from "./Markdown";

export interface MarkdownEditorProps {
  /** Form field name: the text is submitted with the form. */
  name: string;
  defaultValue?: string;
  label: string;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  error?: string;
  /** Called with the text on every change, for live previews next to the editor. */
  onValueChange?: (value: string) => void;
}

type Edit = { value: string; from: number; to: number };

const wrap = (v: string, s: number, e: number, a: string, b: string, ph: string): Edit => {
  const mid = v.slice(s, e) || ph;
  return { value: v.slice(0, s) + a + mid + b + v.slice(e), from: s + a.length, to: s + a.length + mid.length };
};

/** Prefix every selected line; numbered lists count up. */
const prefixLines = (v: string, s: number, e: number, pre: (n: number) => string): Edit => {
  const start = v.lastIndexOf("\n", s - 1) + 1;
  const endNl = v.indexOf("\n", e);
  const end = endNl < 0 ? v.length : endNl;
  const block = (v.slice(start, end) || "Item").split("\n").map((l, n) => pre(n) + l.replace(/^(#{1,3} |[-•] |\d{1,3}[.)] )/, "")).join("\n");
  return { value: v.slice(0, start) + block + v.slice(end), from: start, to: start + block.length };
};

const TOOLS: { id: string; label: string; icon: Icon; keys?: string; run: (v: string, s: number, e: number) => Edit }[] = [
  { id: "b", label: "Bold", icon: IconBold, keys: "b", run: (v, s, e) => wrap(v, s, e, "**", "**", "bold text") },
  { id: "i", label: "Italic", icon: IconItalic, keys: "i", run: (v, s, e) => wrap(v, s, e, "*", "*", "italic text") },
  { id: "h", label: "Heading", icon: IconHeading, run: (v, s, e) => prefixLines(v, s, e, () => "## ") },
  { id: "ul", label: "Bullet list", icon: IconList, run: (v, s, e) => prefixLines(v, s, e, () => "- ") },
  { id: "ol", label: "Numbered list", icon: IconListNumbers, run: (v, s, e) => prefixLines(v, s, e, (n) => `${n + 1}. `) },
  {
    id: "a", label: "Link", icon: IconLink, keys: "k",
    run: (v, s, e) => {
      const text = v.slice(s, e) || "link text";
      const url = "https://";
      const out = v.slice(0, s) + `[${text}](${url})` + v.slice(e);
      const from = s + text.length + 3;
      return { value: out, from, to: from + url.length };
    },
  },
];

/** Textarea with a small toolbar, shortcuts (Ctrl/Cmd + B, I, K), a Preview tab and a character count. Submits as a normal field. */
export function MarkdownEditor({ name, defaultValue = "", label, maxLength = 5000, rows = 8, placeholder, required, error, onValueChange }: MarkdownEditorProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ta = useRef<HTMLTextAreaElement>(null);
  const sel = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    if (sel.current && ta.current) { ta.current.focus(); ta.current.setSelectionRange(...sel.current); sel.current = null; }
  }, [value]);

  const set = (v: string) => { setValue(v); onValueChange?.(v); };
  const apply = (run: (typeof TOOLS)[number]["run"]) => {
    const el = ta.current;
    if (!el) return;
    const r = run(value, el.selectionStart, el.selectionEnd);
    if (r.value.length > maxLength) return;
    sel.current = [r.from, r.to];
    set(r.value);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const t = TOOLS.find((x) => x.keys === e.key.toLowerCase());
    if (t) { e.preventDefault(); apply(t.run); }
  };
  const left = maxLength - value.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-[var(--ds-on-surface)]">{label}{required ? <span aria-hidden> *</span> : null}</label>
        <div role="tablist" aria-label="Write or preview" className="flex gap-1 rounded-full bg-white/[0.05] p-1">
          {(["write", "preview"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("h-8 rounded-full px-3 text-xs capitalize", FOCUS, tab === t ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "text-[var(--ds-on-surface-variant)]")}>{t}</button>
          ))}
        </div>
      </div>
      {tab === "write" ? (
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.keys ? `${t.label} (Ctrl+${t.keys.toUpperCase()})` : t.label} aria-label={t.label} onClick={() => apply(t.run)} className={cn(ICON_BTN, "h-9 w-9")}>
              <t.icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
      {/* Always mounted so the text still submits from the Preview tab. */}
      <textarea ref={ta} id={id} name={name} value={value} rows={rows} maxLength={maxLength} required={required} placeholder={placeholder}
        onChange={(e) => set(e.target.value)} onKeyDown={onKey} hidden={tab === "preview"} aria-invalid={error ? true : undefined} aria-describedby={`${id}-count`}
        className={cn(INPUT, "h-auto resize-y py-3 leading-6")} />
      {tab === "preview" ? (
        <div className="min-h-24 rounded-xl bg-white/[0.035] p-4">
          {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing to preview yet.</p>}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3 text-xs">
        <p role={error ? "alert" : undefined} className={error ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"}>{error ?? "Use **bold**, *italic*, - lists and [links](https://...)."}</p>
        <p id={`${id}-count`} className={cn("shrink-0 tabular-nums", left < 100 ? "text-[var(--ds-color-warning-400)]" : "text-[var(--ds-on-surface-muted)]")}>{value.length} / {maxLength}</p>
      </div>
    </div>
  );
}
