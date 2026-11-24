import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/tone";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import type { Ctx } from "@smw/feature-kit";
import { BlockService } from "../block-service";
import { RulesService } from "../rules-service";
import { TimetableService } from "../service";
import { removeBlockAction, saveBlockAction } from "./actions";
import { ActionForm } from "./ActionForm";
import { orNotFound } from "./guard";

const SMALL = `${INPUT} w-20`;
type Draft = { id?: string; classId: string; className: string; name: string; periodsPerWeek: number; doubles: number; options: { subjectId: string; subject: string; teacherId: string | null; roomId?: string | null }[] };

/** Step 5: elective blocks. Alternatives taught at the same time to a whole class, prefilled from subject groups and elective subjects. */
export async function electivesStep(ctx: Ctx, next: string) {
  const blocks = new BlockService(ctx);
  const [have, ideas, teachers, rooms] = await orNotFound(Promise.all([blocks.list(), blocks.suggestions(), new TimetableService(ctx).teachers(), new RulesService(ctx).rooms()]));
  const drafts: { key: string; saved: boolean; d: Draft }[] = [
    ...have.map((b) => ({ key: b.id, saved: true, d: { id: b.id, classId: b.classId, className: b.className, name: b.name, periodsPerWeek: b.periodsPerWeek, doubles: b.doubles, options: b.options.map((o) => ({ subjectId: o.subjectId, subject: o.subject, teacherId: o.teacherId, roomId: o.roomId })) } })),
    ...ideas.map((s) => ({ key: `${s.classId}:${s.name}`, saved: false, d: { ...s, doubles: 0 } })),
  ];
  return (
    <Panel title="5. Electives" action={<Link href={next} className="text-xs text-[var(--ds-color-primary-300)] underline">Skip to generate</Link>}>
      <p className="mb-4 max-w-prose text-sm text-[var(--ds-on-surface-variant)]">An elective block is a set of alternative subjects taught at the same time to a whole class, such as Hindi, Sanskrit and French. Every section is in the block at that period; each student goes to the subject they chose, with its own teacher. Check each block, pick a teacher for every subject, and save it. Skip this step if your school has none.</p>
      {!drafts.length ? <WidgetEmptyState title="No electives found" description="Make subject groups or mark class subjects as elective in the class page, and they show up here to turn into blocks." /> : (
        <ul className="flex flex-col gap-3">
          {drafts.map(({ key, saved, d }) => (
            <li key={key} className="rounded-2xl bg-white/[0.03] px-4 py-3">
              <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ds-on-surface)]">{d.className}: {d.name}
                <span className="text-xs font-normal text-[var(--ds-on-surface-muted)]">{saved ? "saved" : "suggested, not saved yet"}</span></p>
              <ActionForm action={saveBlockAction} submitLabel={saved ? "Save changes" : "Save block"} className="flex flex-col gap-3">
                {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
                <input type="hidden" name="classId" value={d.classId} />
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Block name
                    <input name="name" required maxLength={60} defaultValue={d.name} className={`${INPUT} w-52`} /></label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Periods a week
                    <input name="periodsPerWeek" type="number" min={1} max={12} defaultValue={d.periodsPerWeek} className={SMALL} /></label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Doubles
                    <input name="doubles" type="number" min={0} max={6} defaultValue={d.doubles} className={SMALL} /></label>
                </div>
                <div className="flex flex-col gap-2">
                  {d.options.map((o, i) => (
                    <div key={o.subjectId} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name={`subject:${i}`} value={o.subjectId} />
                      <span className="w-36 pb-2 text-sm text-[var(--ds-on-surface)]">{o.subject}</span>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Teacher for {o.subject}
                        <select name={`teacher:${i}`} required defaultValue={o.teacherId ?? ""} className={`${INPUT} min-w-48`}>
                          <option value="">Choose a teacher</option>
                          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select></label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Room (optional)
                        <select name={`room:${i}`} defaultValue={o.roomId ?? ""} className={`${INPUT} min-w-40`}>
                          <option value="">Any classroom</option>
                          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select></label>
                    </div>
                  ))}
                </div>
              </ActionForm>
              {saved ? <div className="mt-2"><ActionButton action={removeBlockAction} values={{ id: d.id! }} label="Delete block" variant="ghost"
                confirm={{ title: `Delete ${d.name}?`, body: "It is removed from every timetable, live ones included. Covers set for it are removed too.", confirmLabel: "Delete", danger: true }} /></div> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
