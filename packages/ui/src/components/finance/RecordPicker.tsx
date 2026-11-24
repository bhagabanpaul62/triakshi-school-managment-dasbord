"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { INPUT } from "../../shell/FormModal";
import { FOCUS } from "./ui";

export interface PickerOption {
  id: string;
  label: string;
  /** Second line: class, admission number, phone. */
  meta?: string;
}

export interface RecordPickerProps {
  /** Looks up records for the typed text. Pass a server action. */
  action: (q: string) => Promise<PickerOption[]>;
  /** Field name. Posts the chosen id (a multiple picker posts the name once per id). */
  name: string;
  label: string;
  multiple?: boolean;
  /** Already chosen records. */
  initial?: PickerOption[];
  placeholder?: string;
  required?: boolean;
  error?: string;
  /** Fires with everything chosen after each change. */
  onChange?: (picked: PickerOption[]) => void;
  /** Press "/" anywhere to jump to the first picker on the page. Default true. */
  hotkey?: boolean;
}

// Several pickers can be mounted; only the first one answers "/".
const owners: HTMLInputElement[] = [];

/** Search as you type, pick with arrows and Enter. A combobox: the input keeps focus, the list is announced through aria-activedescendant. */
export function RecordPicker({ action, name, label, multiple, initial = [], placeholder = "Search", required, error, onChange, hotkey = true }: RecordPickerProps) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [picked, setPicked] = useState<PickerOption[]>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  useEffect(() => {
    const el = input.current;
    if (!hotkey || !el) return;
    owners.push(el);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || owners[0] !== el) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); owners.splice(owners.indexOf(el), 1); };
  }, [hotkey]);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    setState("loading");
    const t = setTimeout(async () => {
      try {
        const r = await action(q.trim());
        if (mine !== seq.current) return;
        setResults(r.filter((o) => !picked.some((p) => p.id === o.id)));
        setActive(0);
        setState("idle");
      } catch {
        if (mine === seq.current) setState("failed");
      }
    }, 250);
    return () => clearTimeout(t);
    // picked is read only to hide chosen rows; re-running on it would refetch after every pick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, action]);

  const commit = (next: PickerOption[]) => { setPicked(next); onChange?.(next); };
  const choose = (o: PickerOption) => {
    commit(multiple ? [...picked, o] : [o]);
    setQ("");
    setOpen(false);
    input.current?.focus();
  };
  const optId = (i: number) => `${uid}-opt-${i}`;
  const showList = open && state === "idle" && results.length > 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Home" && showList) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && showList) { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === "Enter" && showList) { e.preventDefault(); const o = results[active]; if (o) choose(o); }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
    else if (e.key === "Backspace" && q === "" && multiple && picked.length) commit(picked.slice(0, -1));
  };

  const status = state === "loading" ? "Searching" : state === "failed" ? "Search failed" : open ? (results.length ? `${results.length} results` : "No results") : "";

  return (
    <div className="relative flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${uid}-in`} className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--ds-color-danger-400)]" aria-hidden> *</span> : null}
      </label>
      {picked.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Chosen ${label.toLowerCase()}`}>
          {picked.map((p) => (
            <li key={p.id} className="flex min-h-10 max-w-full items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-4 pr-1 text-sm">
              <span className="min-w-0 truncate">{p.label}{p.meta ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{p.meta}</span> : null}</span>
              <button type="button" onClick={() => commit(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.label}`} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.1]", FOCUS)}>
                <IconX className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Always mounted: the "/" hotkey holds this element, so a single picker hides it once filled instead of removing it. */}
      <div className={cn("relative", !multiple && picked.length > 0 && "hidden")}>
          <IconSearch aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-on-surface-muted)]" />
          <input
            ref={input}
            id={`${uid}-in`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={showList ? optId(active) : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${uid}-status${error ? ` ${uid}-err` : ""}`}
            autoComplete="off"
            value={q}
            placeholder={placeholder}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className={cn(INPUT, "pl-9")}
          />
          {showList ? (
            <ul id={`${uid}-list`} role="listbox" aria-label={label} className="custom-scrollbar absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl bg-[var(--ds-surface-container-highest)] p-1 shadow-lg">
              {results.map((o, i) => (
                // mouse down, not click: the input must not lose focus (and close the list) before the pick lands
                <li key={o.id} id={optId(i)} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseMove={() => setActive(i)}
                  className={cn("flex min-h-10 cursor-pointer flex-col justify-center rounded-xl px-3 py-1.5", i === active && "bg-white/[0.08]")}>
                  <span className="truncate text-sm text-[var(--ds-on-surface)]">{o.label}</span>
                  {o.meta ? <span className="truncate text-xs text-[var(--ds-on-surface-muted)]">{o.meta}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      <p id={`${uid}-status`} role="status" className={cn("text-xs text-[var(--ds-on-surface-muted)]", !(open && (state !== "idle" || results.length === 0)) && "sr-only")}>{status}</p>
      {error ? <p id={`${uid}-err`} role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}
      {picked.map((p) => <input key={p.id} type="hidden" name={name} value={p.id} />)}
    </div>
  );
}
