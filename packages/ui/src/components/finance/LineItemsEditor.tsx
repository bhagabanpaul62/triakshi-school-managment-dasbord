"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconTrash } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { INPUT } from "../../shell/FormModal";
import { Money } from "./Money";
import { MoneyInput } from "./MoneyInput";
import { ICON_BTN, PILL_BTN } from "./ui";
import { duplicateAt, moveItem, sumPaise } from "./logic";

export interface Line {
  /** Stable key for the row, never posted. */
  id: string;
  headId: string;
  label: string;
  amountPaise: number;
  /** Free tag the owner understands, for example "fee" or "deposit". */
  kind: string;
}

export interface LineItemsEditorProps {
  /** Choices for the head picker. */
  heads: { id: string; label: string }[];
  lines: Line[];
  /** Controlled: receives the whole new list on every change. */
  onChange?: (lines: Line[]) => void;
  readOnly?: boolean;
  /** When set, posts the lines as one JSON field (without row ids). */
  name?: string;
  /** Error text by line id. */
  errors?: Record<string, string>;
  /** Optional second picker for Line.kind. Omit to keep kinds as they are. */
  kinds?: { value: string; label: string }[];
  /** Kind given to a new row. Default "fee". */
  defaultKind?: string;
  /** Label for the total row. Default "Total". */
  totalLabel?: string;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `l${Date.now()}${Math.random().toString(36).slice(2, 8)}`);

/** Rows of head, description and amount with a running total. Add, remove, duplicate, and move rows with buttons or Alt plus Arrow keys. */
export function LineItemsEditor({ heads, lines, onChange, readOnly, name, errors = {}, kinds, defaultKind = "fee", totalLabel = "Total" }: LineItemsEditorProps) {
  const uid = useId();
  const [note, setNote] = useState("");
  const refocus = useRef<{ id: string; part: string } | null>(null);
  const total = sumPaise(lines);
  const headName = (id: string) => heads.find((h) => h.id === id)?.label ?? "";

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const el = document.getElementById(`${uid}-${r.id}-${r.part}`) as HTMLButtonElement | null;
    (el && !el.disabled ? el : document.getElementById(`${uid}-${r.id}-label`))?.focus();
  });

  if (readOnly) {
    return (
      <div className="custom-scrollbar overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
              <th scope="col" className="pb-2 text-left font-normal">Head</th>
              <th scope="col" className="pb-2 text-left font-normal">Description</th>
              <th scope="col" className="pb-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/[0.06]">
                <th scope="row" className="py-2.5 pr-3 text-left font-normal text-[var(--ds-on-surface)]">{headName(l.headId) || "-"}</th>
                <td className="py-2.5 pr-3 text-[var(--ds-on-surface-variant)]">{l.label || "-"}</td>
                <td className="py-2.5 text-right"><Money paise={l.amountPaise} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/[0.12]">
              <th scope="row" colSpan={2} className="pt-3 text-left font-medium text-[var(--ds-on-surface)]">{totalLabel}</th>
              <td className="pt-3 text-right"><Money paise={total} size="lg" /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const commit = (next: Line[], say?: string) => { onChange?.(next); if (say) setNote(say); };
  const patch = (id: string, p: Partial<Line>) => commit(lines.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const move = (i: number, dir: -1 | 1, part: string) => {
    const to = i + dir;
    if (to < 0 || to >= lines.length) return;
    refocus.current = { id: lines[i]!.id, part };
    commit(moveItem(lines, i, dir), `Line moved to position ${to + 1} of ${lines.length}.`);
  };
  const dup = (i: number) => {
    const copy = newId();
    refocus.current = { id: copy, part: "label" };
    commit(duplicateAt(lines, i, (l) => ({ ...l, id: copy })), `Line ${i + 1} duplicated.`);
  };
  const remove = (i: number) => commit(lines.filter((_, j) => j !== i), `Line ${i + 1} removed.`);
  const add = () => {
    const id = newId();
    refocus.current = { id, part: "head" };
    commit([...lines, { id, headId: heads[0]?.id ?? "", label: "", amountPaise: 0, kind: defaultKind }], `Line ${lines.length + 1} added.`);
  };

  return (
    <div className="min-w-0">
      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => {
          const err = errors[l.id];
          const keys = (part: string) => (e: React.KeyboardEvent) => {
            if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            move(i, e.key === "ArrowUp" ? -1 : 1, part);
          };
          return (
            <li key={l.id} className="rounded-2xl bg-white/[0.04] p-3" aria-label={`Line ${i + 1}`}>
              <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9rem]", kinds && "lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_8rem_8rem]")}>
                <select id={`${uid}-${l.id}-head`} aria-label={`Head, line ${i + 1}`} value={l.headId} onChange={(e) => patch(l.id, { headId: e.target.value })} onKeyDown={keys("head")} aria-invalid={err ? true : undefined} className={INPUT}>
                  {heads.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                </select>
                <input id={`${uid}-${l.id}-label`} aria-label={`Description, line ${i + 1}`} placeholder="Description" value={l.label} onChange={(e) => patch(l.id, { label: e.target.value })} onKeyDown={keys("label")} aria-invalid={err ? true : undefined} className={INPUT} />
                <MoneyInput label={`Amount, line ${i + 1}`} labelHidden valuePaise={l.amountPaise} onChange={(p) => patch(l.id, { amountPaise: p ?? 0 })} />
                {kinds ? (
                  <select aria-label={`Kind, line ${i + 1}`} value={l.kind} onChange={(e) => patch(l.id, { kind: e.target.value })} className={INPUT}>
                    {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                ) : null}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p role={err ? "alert" : undefined} className="min-w-0 flex-1 text-xs text-[var(--ds-color-danger-400)]">{err}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" id={`${uid}-${l.id}-up`} onClick={() => move(i, -1, "up")} disabled={i === 0} aria-label={`Move line ${i + 1} up`} title="Move up (Alt + Arrow up)" className={ICON_BTN}><IconArrowUp className="h-4 w-4" aria-hidden /></button>
                  <button type="button" id={`${uid}-${l.id}-down`} onClick={() => move(i, 1, "down")} disabled={i === lines.length - 1} aria-label={`Move line ${i + 1} down`} title="Move down (Alt + Arrow down)" className={ICON_BTN}><IconArrowDown className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => dup(i)} aria-label={`Duplicate line ${i + 1}`} title="Duplicate" className={ICON_BTN}><IconCopy className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`} title="Remove" className={cn(ICON_BTN, "hover:bg-[var(--ds-color-danger-500)]/15 hover:text-[var(--ds-color-danger-400)]")}><IconTrash className="h-4 w-4" aria-hidden /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={add} className={PILL_BTN}><IconPlus className="h-4 w-4" aria-hidden />Add line</button>
        <p aria-live="polite" className="flex items-baseline gap-3 text-sm text-[var(--ds-on-surface-variant)]">{totalLabel} <Money paise={total} size="lg" /></p>
      </div>
      <p role="status" className="sr-only">{note}</p>
      {name ? <input type="hidden" name={name} value={JSON.stringify(lines.map(({ headId, label, amountPaise, kind }) => ({ headId, label, amountPaise, kind })))} /> : null}
    </div>
  );
}
