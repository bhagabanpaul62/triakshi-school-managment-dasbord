"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { cn } from "@smw/ui/utils";
import { INPUT } from "@smw/ui/shell/FormModal";
import { ModalField } from "@smw/ui/kit/Modal";
import type { AudiencePreview, AudienceOptions, PersonHit } from "../audience";
import type { Audience, AudienceRule } from "../audience-rules";
import { previewAudience, searchPeople } from "./audience-actions";

type RuleType = AudienceRule["type"];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
const PILL = `inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${FOCUS}`;

export interface AudiencePickerProps {
  /** Form field that carries the audience as JSON. */
  name: string;
  value: Audience;
  onChange?: (a: Audience) => void;
  /** From audienceOptions(). */
  options: AudienceOptions;
  /** Rule types the caller may choose. Default: all. */
  allow?: RuleType[];
  /** Names for rules that arrive pre-filled (student and person rules), keyed "type:id". */
  labels?: Record<string, string>;
}

interface Entry { key: string; label: string; meta: string; rule: AudienceRule }
const keyOf = (r: AudienceRule) => JSON.stringify(r);
const sameRules = (a: AudienceRule[], b: AudienceRule[]) => a.length === b.length && a.every((r) => b.some((x) => keyOf(x) === keyOf(r)));

export function AudiencePicker({ name, value, onChange, options, allow, labels = {} }: AudiencePickerProps) {
  const uid = useId();
  const [inner, setInner] = useState(value);
  const audience = onChange ? value : inner;
  const [names, setNames] = useState<Record<string, string>>(labels);
  const [open, setOpen] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const ok = (t: RuleType) => !allow || allow.includes(t);
  // An empty choice is only an error once the person has chosen something or tried to send.
  const [touched, setTouched] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest("form");
    const mark = () => setTouched(true);
    form?.addEventListener("submit", mark, true);
    return () => form?.removeEventListener("submit", mark, true);
  }, []);
  const set = (a: Audience) => { setTouched(true); setInner(a); onChange?.(a); };

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const add = (rule: AudienceRule, label: string, meta: string) => { if (ok(rule.type)) out.push({ key: keyOf(rule), label, meta, rule }); };
    for (const c of options.classes) add({ type: "class", id: c.id }, c.name, "Whole class");
    for (const s of options.sections) add({ type: "section", id: s.id }, s.name, "Section");
    for (const h of options.houses) add({ type: "house", id: h.id }, `${h.name} house`, "House");
    const routeName = new Map(options.routes.map((r) => [r.id, r.name]));
    for (const r of options.routes) add({ type: "route", id: r.id }, `Bus route ${r.name}`, "Transport");
    for (const s of options.stops) add({ type: "stop", id: s.id }, `Stop ${s.name}`, `Transport, route ${routeName.get(s.routeId) ?? ""}`);
    for (const s of options.subjects) add({ type: "subject", id: s.id }, `${s.name} students`, "Subject");
    for (const r of options.roles) add({ type: "role", id: r.id }, r.name, "Staff role");
    for (const g of options.groups) add({ type: "group", id: g.id }, g.name, g.shared ? "Saved group, shared" : "Saved group");
    if (options.canFeeOverdue) for (const days of [0, 30, 60]) add({ type: "fee_overdue", days }, days ? `Fees overdue by more than ${days} days` : "Fees overdue", "Fees team only");
    return out;
    // ok() reads only `allow`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, allow]);

  const labelOf = (r: AudienceRule): string => {
    const fixed: Partial<Record<RuleType, string>> = { everyone: "Everyone", families: "All families", staff: "All staff" };
    return fixed[r.type] ?? entries.find((e) => e.key === keyOf(r))?.label ?? names[`${r.type}:${"id" in r ? r.id : ""}`]
      ?? (r.type === "student" ? "One student" : r.type === "person" ? "One person" : r.type === "section" ? "A section" : "A removed item");
  };

  const mine = useMemo<AudienceRule[]>(() => (ok("section") ? options.mySections.map((id) => ({ type: "section", id })) : []), [options.mySections, allow]); // eslint-disable-line react-hooks/exhaustive-deps
  const quick: { label: string; rules: AudienceRule[] }[] = [
    ...(ok("everyone") ? [{ label: "Everyone", rules: [{ type: "everyone" } as AudienceRule] }] : []),
    ...(ok("families") ? [{ label: "All families", rules: [{ type: "families" } as AudienceRule] }] : []),
    ...(ok("staff") ? [{ label: "All staff", rules: [{ type: "staff" } as AudienceRule] }] : []),
    ...(mine.length ? [{ label: "My sections", rules: mine }] : []),
  ];

  const pick = (side: "include" | "exclude", e: Entry, label?: string) => {
    if (label) setNames((n) => ({ ...n, [`${e.rule.type}:${"id" in e.rule ? e.rule.id : ""}`]: label }));
    if (audience[side].some((r) => keyOf(r) === e.key)) return;
    // "Everyone" already covers anything added next to it, so choosing something narrower replaces it.
    set({ ...audience, [side]: [...(side === "include" ? audience.include.filter((r) => r.type !== "everyone") : audience.exclude), e.rule] });
  };
  const drop = (side: "include" | "exclude", r: AudienceRule) => set({ ...audience, [side]: audience[side].filter((x) => keyOf(x) !== keyOf(r)) });

  // Live count: waits for a pause in clicking, drops answers that arrive late.
  const [state, setState] = useState<{ kind: "loading" } | { kind: "empty" } | { kind: "error"; message: string } | { kind: "ok"; p: AudiencePreview & { text: string } }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);
  const json = JSON.stringify(audience);
  useEffect(() => {
    const mineSeq = ++seq.current;
    setState({ kind: "loading" });
    if (!audience.include.length) { setState({ kind: "empty" }); return; }
    const t = setTimeout(async () => {
      const fd = new FormData();
      fd.set("audience", json);
      try {
        const r = await previewAudience(fd);
        if (mineSeq !== seq.current) return;
        setState(r.ok ? { kind: "ok", p: r.data } : { kind: "error", message: r.error });
      } catch { if (mineSeq === seq.current) setState({ kind: "error", message: "Could not count people." }); }
    }, 300);
    return () => clearTimeout(t);
    // json stands for audience
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, retry]);

  const count = state.kind === "ok" ? state.p : null;
  const sentence = count ? (count.total === 0 ? "Nobody will get this" : [count.families ? `${count.families} ${count.families === 1 ? "family" : "families"}` : "", count.staff ? `${count.staff} staff` : ""].filter(Boolean).join(", ")) : "";

  const chip = (side: "include" | "exclude", r: AudienceRule) => (
    <li key={keyOf(r)} className="flex min-h-10 max-w-full items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-4 pr-1 text-sm">
      <span className="min-w-0 truncate">{labelOf(r)}</span>
      <button type="button" onClick={() => drop(side, r)} aria-label={`Remove ${labelOf(r)}`} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.1]", FOCUS)}>
        <IconX className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-3">
      <input type="hidden" name={name} value={json} />
      <div role="group" aria-label="Quick choices" className="flex flex-wrap gap-2">
        {quick.map((q) => {
          const on = sameRules(audience.include, q.rules) && audience.exclude.length === 0;
          return (
            <button key={q.label} type="button" aria-pressed={on} onClick={() => set({ include: q.rules, exclude: [] })}
              className={cn(PILL, on ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]")}>
              {q.label}
            </button>
          );
        })}
        <button type="button" aria-expanded={open} aria-controls={`${uid}-more`} onClick={() => setOpen((o) => !o)} className={cn(PILL, "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]")}>
          Choose people
          <IconChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {audience.include.length ? <ul aria-label="Reaching" className="flex flex-wrap gap-2">{audience.include.map((r) => chip("include", r))}</ul> : null}

      {open ? (
        <div id={`${uid}-more`} className="flex flex-col gap-3">
          <ModalField label="Add classes, sections, houses, routes, subjects, roles or people" htmlFor={`${uid}-add`}>
            <RuleSearch id={`${uid}-add`} entries={entries} people={ok("student") || ok("person")} taken={audience.include} onPick={(e, l) => pick("include", e, l)} />
          </ModalField>
          <ModalField label="Except" htmlFor={`${uid}-except`} hint="People here are left out, even when they match above.">
            <RuleSearch id={`${uid}-except`} entries={entries} people={ok("student") || ok("person")} taken={audience.exclude} onPick={(e, l) => pick("exclude", e, l)} />
          </ModalField>
        </div>
      ) : null}
      {audience.exclude.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">Except</span>
          <ul aria-label="Left out" className="flex flex-wrap gap-2">{audience.exclude.map((r) => chip("exclude", r))}</ul>
        </div>
      ) : null}

      <div aria-live="polite" className="text-sm text-[var(--ds-on-surface)]">
        {state.kind === "loading" ? <span className="text-[var(--ds-on-surface-muted)]">Counting people</span> : null}
        {state.kind === "empty" ? <span className={touched ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"} role={touched ? "alert" : undefined}>Choose who it is for.</span> : null}
        {state.kind === "error" ? (
          <span className="text-[var(--ds-color-danger-400)]">{state.message}{" "}
            {audience.include.length ? <button type="button" onClick={() => setRetry((n) => n + 1)} className={cn("rounded-full underline", FOCUS)}>Try again</button> : null}
          </span>
        ) : null}
        {count ? (
          <>
            <p className="font-medium">{sentence}</p>
            {count.sample.length ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{count.sample.join(", ")}{count.total > count.sample.length ? " and others" : ""}</p> : null}
          </>
        ) : null}
      </div>

      {count && count.unreachable.length ? (
        <div>
          <button type="button" aria-expanded={showSkipped} aria-controls={`${uid}-skipped`} onClick={() => setShowSkipped((s) => !s)} className={cn("inline-flex min-h-10 items-center gap-2 rounded-full text-sm text-[var(--ds-on-surface-variant)]", FOCUS)}>
            {count.unreachable.length}{count.unreachable.length === 100 ? "+" : ""} will not get a message on their phone or email
            <IconChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", showSkipped && "rotate-180")} />
          </button>
          {showSkipped ? (
            <ul id={`${uid}-skipped`} className="custom-scrollbar mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {count.unreachable.map((u, i) => (
                <li key={i} className="flex flex-col rounded-xl bg-white/[0.04] px-3 py-1.5 text-sm">
                  <span>{u.name} <span className="text-xs text-[var(--ds-on-surface-muted)]">{u.label}</span></span>
                  <span className="text-xs text-[var(--ds-on-surface-muted)]">{u.why}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A combobox over the school's own lists, plus people found on the server. The input keeps focus; the list is announced through aria-activedescendant. */
function RuleSearch({ id, entries, people, taken, onPick }: { id: string; entries: Entry[]; people: boolean; taken: AudienceRule[]; onPick: (e: Entry, label?: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Entry[]>([]);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const text = q.trim().toLowerCase();

  useEffect(() => {
    setFailed(false);
    if (!people || text.length < 2) { setFound([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const fd = new FormData();
      fd.set("q", q.trim());
      try {
        const r = await searchPeople(fd);
        if (mine !== seq.current) return;
        if (!r.ok) { setFailed(true); return; }
        setFound((r.data as PersonHit[]).map((h) => ({ key: JSON.stringify({ type: h.type, id: h.id }), label: h.label, meta: h.meta, rule: { type: h.type, id: h.id } })));
      } catch { if (mine === seq.current) setFailed(true); }
    }, 250);
    return () => clearTimeout(t);
    // q is read through text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, people]);

  const results = useMemo(() => {
    const free = (e: Entry) => !taken.some((r) => keyOf(r) === e.key);
    const own = entries.filter((e) => free(e) && (!text || e.label.toLowerCase().includes(text) || e.meta.toLowerCase().includes(text))).slice(0, text ? 12 : 8);
    return [...own, ...found.filter(free)];
  }, [entries, found, taken, text]);
  const showList = open && results.length > 0;
  const opt = (i: number) => `${id}-opt-${i}`;
  useEffect(() => setActive(0), [text]);

  const choose = (e: Entry) => { onPick(e, found.includes(e) ? e.label : undefined); setQ(""); setFound([]); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && showList) { e.preventDefault(); const r = results[active]; if (r) choose(r); }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="relative">
      <input id={id} role="combobox" aria-expanded={showList} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={showList ? opt(active) : undefined}
        aria-describedby={`${id}-status`} autoComplete="off" value={q} placeholder={people ? "Type a class, a house, a name" : "Type to search"} className={INPUT}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      {showList ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Matches" className="custom-scrollbar absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl bg-[var(--ds-surface-container-highest)] p-1 shadow-lg">
          {results.map((r, i) => (
            // mouse down, not click: the input must keep focus until the pick lands
            <li key={r.key} id={opt(i)} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(r); }} onMouseMove={() => setActive(i)}
              className={cn("flex min-h-10 cursor-pointer flex-col justify-center rounded-xl px-3 py-1.5", i === active && "bg-white/[0.08]")}>
              <span className="truncate text-sm text-[var(--ds-on-surface)]">{r.label}</span>
              <span className="truncate text-xs text-[var(--ds-on-surface-muted)]">{r.meta}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p id={`${id}-status`} role="status" className={cn("text-xs text-[var(--ds-on-surface-muted)]", !(open && (failed || results.length === 0)) && "sr-only")}>
        {failed ? "Search failed" : open ? (results.length ? `${results.length} matches` : "No matches") : ""}
      </p>
    </div>
  );
}
