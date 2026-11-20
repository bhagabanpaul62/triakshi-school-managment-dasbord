import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { dayName, formatTime, istDate } from "../bell";
import { SubstitutionService } from "../substitution-service";
import { assignCover, clearCover } from "./actions";
import { ActionForm } from "./ActionForm";
import { orNotFound } from "./guard";
import { LinkButton } from "./LinkButton";

export const metadata = { title: "Substitutions" };

/** /app/timetable/substitutions?date=: who is away, which periods that leaves open, and who can cover. */
export default async function SubstitutionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : istDate(new Date());
  const also = ([] as string[]).concat(sp.also ?? []);
  const board = await orNotFound(new SubstitutionService(ctx).board(date, also));
  const addable = board.teachers.filter((t) => !board.absent.some((a) => a.teacherId === t.id));

  return (
    <>
      <PageHeader eyebrow="Timetable" title="Substitutions" description="Cover the periods of teachers who are away. A free teacher with the lowest load that day comes first."
        actions={<LinkButton href="/app/timetable">Timetable</LinkButton>} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Date
          <input type="date" name="date" defaultValue={date} className={INPUT} required /></label>
        {also.map((id) => <input key={id} type="hidden" name="also" value={id} />)}
        <Button type="submit" variant="secondary" className="rounded-full">Show</Button>
        {addable.length ? (
          <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Teacher away but not marked
            <select name="also" className={INPUT} defaultValue="">
              <option value="">Add a teacher</option>
              {addable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
        ) : null}
      </form>
      {board.day === null ? (
        <Panel title={date}><WidgetEmptyState title="Sunday" description="The school week runs Monday to Saturday." /></Panel>
      ) : !board.absent.length ? (
        <Panel title={`${dayName(board.day)}, ${date}`}>
          <WidgetEmptyState title="Nobody is away" description="Teachers marked absent or on approved leave show up here. If someone is away but not marked, add them above." />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {board.absent.map((t) => (
            <Panel key={t.teacherId} title={t.name} action={<ToneBadge tone="warning" label={t.reason} />}>
              {!t.periods.length ? <p className="text-sm text-[var(--ds-on-surface-muted)]">No classes on {dayName(board.day!)}.</p> : (
                <ul className="flex flex-col gap-3">
                  {t.periods.map((p) => (
                    <li key={`${p.slotId}:${p.optionId ?? ""}`} className="rounded-2xl bg-white/[0.03] px-4 py-3">
                      <p className="text-sm text-[var(--ds-on-surface)]">{p.period} <span className="text-xs text-[var(--ds-on-surface-muted)]">{formatTime(p.startsAt)}</span> · {p.section} · {p.subject}</p>
                      {p.cover ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                          <ToneBadge tone="success" label={`Covered by ${p.cover.name}`} />
                          {p.cover.note ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{p.cover.note}</span> : null}
                          <ActionButton action={clearCover} values={{ date, slotId: p.slotId, optionId: p.optionId ?? "" }} label="Remove cover" variant="ghost"
                            confirm={{ title: "Remove this cover?", body: `${p.cover.name} is told the cover is cancelled.`, confirmLabel: "Remove" }} />
                        </div>
                      ) : (
                        <ActionForm action={assignCover} submitLabel="Assign" className="mt-2 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="date" value={date} /><input type="hidden" name="slotId" value={p.slotId} /><input type="hidden" name="optionId" value={p.optionId ?? ""} />
                          <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Cover teacher
                            <select name="coverTeacherId" required defaultValue={p.suggestions[0]?.id ?? ""} className={`${INPUT} min-w-52`}>
                              {!p.suggestions.length ? <option value="">Nobody is free</option> : null}
                              {p.suggestions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.sameSubject ? "same subject, " : ""}{s.load} {s.load === 1 ? "period" : "periods"} today)</option>)}
                            </select></label>
                          <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Note (optional)
                            <input name="note" maxLength={200} placeholder="Chapter 4 worksheet" className={`${INPUT} min-w-52`} /></label>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
