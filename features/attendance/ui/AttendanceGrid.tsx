"use client";

import { memo, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { IconCheck } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { initials } from "@smw/ui/format";
import { STATUS_LABEL, STATUS_TONE, type AttendanceStatus } from "../constants";

export type GridRow = { id: string; name: string; meta?: string; status: AttendanceStatus | null };

type Marks = Record<string, AttendanceStatus | null>;

const RowButton = memo(function RowButton({ row, status, onCycle, canMark }: { row: GridRow; status: AttendanceStatus | null; onCycle: (id: string) => void; canMark: boolean }) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px]">{initials(row.name)}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-[var(--ds-on-surface)]">{row.name}</span>
        {row.meta ? <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{row.meta}</span> : null}
      </span>
      {status ? <ToneBadge label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} /> : <span className="text-xs text-[var(--ds-on-surface-muted)]">Not marked</span>}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 min-h-12";
  if (!canMark) return <li><div className={cls}>{body}</div></li>;
  return (
    <li>
      <button type="button" onClick={() => onCycle(row.id)} aria-label={`${row.name}: ${status ? STATUS_LABEL[status] : "not marked"}. Tap to change.`}
        className={`${cls} transition duration-150 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] active:scale-[0.98] active:bg-white/[0.08] motion-reduce:transition-none`}>
        {body}
      </button>
    </li>
  );
});

/**
 * The one-tap attendance grid for students and staff. Tap a row to cycle its status, "All present" fills the rest,
 * the sticky bar shows the running counts and saves everything with one server action.
 * Remount it (key) when the section or date changes.
 */
export function AttendanceGrid({ rows, statuses, idKey, hidden, action, canMark, notice, noun }: {
  rows: GridRow[];
  /** Cycle order; the first is what an unmarked row becomes on first tap. */
  statuses: readonly AttendanceStatus[];
  /** Field the service expects for each row: "studentId" or "userId". */
  idKey: "studentId" | "userId";
  hidden: Record<string, string>;
  action: (fd: FormData) => Promise<FormResult>;
  canMark: boolean;
  /** Why marking is off (holiday, future date), shown instead of the bar. */
  notice?: string;
  noun: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r.status])) as Marks, [rows]);
  const [marks, setMarks] = useState<Marks>(initial);
  const [saved, setSaved] = useState<Marks>(initial);

  const cycle = useCallback((id: string) => {
    navigator.vibrate?.(8);
    setMarks((m) => {
      const i = m[id] ? statuses.indexOf(m[id]) : -1;
      return { ...m, [id]: statuses[(i + 1) % statuses.length]! };
    });
  }, [statuses]);

  // Only fills rows nobody has marked yet, so re-opening a saved sheet never wipes the absentees.
  const allPresent = () => { navigator.vibrate?.(8); setMarks((m) => Object.fromEntries(rows.map((r) => [r.id, m[r.id] ?? "present"])) as Marks); };

  const counts = useMemo(() => {
    const c: Partial<Record<AttendanceStatus, number>> = {};
    let unmarked = 0;
    for (const r of rows) { const s = marks[r.id]; if (s) c[s] = (c[s] ?? 0) + 1; else unmarked++; }
    return { c, unmarked };
  }, [marks, rows]);

  const markedCount = rows.length - counts.unmarked;
  const dirty = rows.some((r) => marks[r.id] !== saved[r.id]);
  const fact = [
    ...statuses.filter((s) => counts.c[s]).map((s) => `${counts.c[s]} ${STATUS_LABEL[s].toLowerCase()}`),
    ...(counts.unmarked ? [`${counts.unmarked} not marked`] : []),
  ].join(" · ") || `0 ${noun}`;
  const hint = counts.unmarked === rows.length ? "Tap All present, then tap anyone who is not." : "Tap a name to change it.";

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const allSaved = !dirty && markedCount > 0;
  const save = () => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
    fd.set("entries", JSON.stringify(rows.filter((r) => marks[r.id]).map((r) => ({ [idKey]: r.id, status: marks[r.id] }))));
    const r = await action(fd);
    if (r.ok) { setSaved(marks); toast(r.message ?? "Saved"); router.refresh(); } else toast(r.error, "danger");
  });

  if (rows.length === 0) return <Panel><WidgetEmptyState title={`No ${noun} here yet.`} description="Add them first, then come back to mark attendance." /></Panel>;

  return (
    <>
      <Panel title={`${rows.length} ${noun}`} action={canMark && counts.unmarked > 0 ? <Button type="button" variant="secondary" className="h-10 rounded-full" onClick={allPresent}>{counts.unmarked === rows.length ? "All present" : "Rest present"}</Button> : undefined}>
        {notice ? <p className="mb-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">{notice}</p> : null}
        {canMark ? <p className="mb-2 text-xs text-[var(--ds-on-surface-muted)]">{hint}</p> : null}
        <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 md:grid-cols-2">
          {rows.map((r) => <RowButton key={r.id} row={r} status={marks[r.id] ?? null} onCycle={cycle} canMark={canMark} />)}
        </ul>
      </Panel>
      {canMark ? (
        <div className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container)] p-4" role="status" aria-live="polite">
          <p className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface)]">{allSaved ? <span className="mr-2 inline-flex items-center gap-1 text-[var(--ds-color-success-400)]"><IconCheck className="h-4 w-4" aria-hidden />Saved</span> : null}{fact}</p>
          <Button type="button" className="h-11 shrink-0 rounded-full" onClick={save} isLoading={pending} disabled={!dirty || markedCount === 0}>{allSaved ? "Saved" : "Save attendance"}</Button>
        </div>
      ) : null}
    </>
  );
}
