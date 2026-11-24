import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { INPUT } from "@smw/ui/tone";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { DAYS } from "../bell";
import { GeneratorService } from "../generator-service";
import { PeriodService } from "../service";
import { RulesService } from "../rules-service";
import { addRoom, generateDraft, removeRoom, saveLoadsAction, saveSettingsAction, saveTeacherRuleAction } from "./actions";
import { ActionForm } from "./ActionForm";
import { orNotFound } from "./guard";
import { electivesStep } from "./electives-step";
import { LinkButton } from "./LinkButton";

export const metadata = { title: "Timetable generator" };

const STEPS = [
  { n: 1, label: "Loads" }, { n: 2, label: "Teachers" }, { n: 3, label: "Rooms" }, { n: 4, label: "Rules" }, { n: 5, label: "Electives" }, { n: 6, label: "Generate" },
] as const;
const SMALL = `${INPUT} w-20`;
const roomFields: Field[] = [
  { name: "name", label: "Room name", required: true, placeholder: "Science Lab" },
  { name: "kind", label: "Kind", required: true, placeholder: "lab", hint: "The same word you type in step 1: lab, computer, music" },
  { name: "capacity", label: "Seats", type: "number", min: 1 },
];

/** /app/timetable/generator: six steps, each saved on its own, then Generate builds a draft to review. */
export default async function GeneratorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const step = Math.min(6, Math.max(1, Number(typeof sp.step === "string" ? sp.step : 1) || 1));
  const rules = new RulesService(ctx);
  const gen = new GeneratorService(ctx);
  await orNotFound(rules.settings()); // managers only: anyone else gets the 404 page
  const bell = await new PeriodService(ctx).all();
  const teachingPeriods = bell.filter((p) => !p.isBreak);
  const link = (n: number) => `/app/timetable/generator?step=${n}`;

  return (
    <>
      <PageHeader eyebrow="Timetable" title="Timetable generator" description="Set the rules once. The system builds every section's week without clashes, as a draft you review before it goes live."
        actions={<LinkButton href="/app/timetable">Timetable</LinkButton>} />
      <nav aria-label="Generator steps" className="mb-4 flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <Link key={s.n} href={link(s.n)} aria-current={s.n === step ? "step" : undefined}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${s.n === step ? "bg-[var(--ds-color-primary-500)]/20 text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.09]"}`}>
            <span className="font-mono text-[11px]">{s.n}</span>{s.label}
          </Link>
        ))}
      </nav>
      {!teachingPeriods.length ? (
        <Panel title="Set up the bell schedule first">
          <WidgetEmptyState title="No periods yet" description="The generator places classes into the periods of your school day." />
          <div className="flex justify-center pb-4"><LinkButton href="/app/timetable/periods">Bell schedule</LinkButton></div>
        </Panel>
      ) : step === 1 ? await loads(rules, link(2))
        : step === 2 ? await teachers(rules, teachingPeriods)
        : step === 3 ? await rooms(rules)
        : step === 4 ? await rulesStep(rules)
        : step === 5 ? await electivesStep(ctx, link(6))
        : await generateStep(gen)}
    </>
  );
}

async function loads(rules: RulesService, next: string) {
  const rows = await orNotFound(rules.loads());
  if (!rows.length) {
    return (
      <Panel title="Periods per week">
        <WidgetEmptyState title="No class subjects yet" description="Add subjects to each class first. They appear here with their teachers." />
        <div className="flex justify-center pb-4"><LinkButton href="/app/academics/classes">Open classes</LinkButton></div>
      </Panel>
    );
  }
  const byClass = new Map<string, typeof rows>();
  for (const r of rows) byClass.set(r.className, [...(byClass.get(r.className) ?? []), r]);
  return (
    <Panel title="1. Periods per week" action={<span className="text-xs text-[var(--ds-on-surface-muted)]">Set 0 to leave a subject out</span>}>
      <p className="mb-4 max-w-prose text-sm text-[var(--ds-on-surface-variant)]">For each class, how many periods a week each subject gets. Doubles are back-to-back pairs (a lab). Room kind is the kind of room it needs. Teachers come from each section&apos;s subject teachers.</p>
      <ActionForm action={saveLoadsAction} submitLabel="Save and continue" next={next}>
        <div className="flex flex-col gap-6">
          {[...byClass].map(([cls, list]) => (
            <section key={cls} aria-label={cls}>
              <h3 className="mb-2 text-sm font-medium text-[var(--ds-on-surface)]">{cls}</h3>
              <div className="custom-scrollbar overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
                    <th className="pb-2 pr-3 font-normal">Subject</th><th className="pb-2 pr-3 font-normal">Periods</th><th className="pb-2 pr-3 font-normal">Doubles</th><th className="pb-2 pr-3 font-normal">Room kind</th><th className="pb-2 font-normal">Teachers</th>
                  </tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.subjectId} className="border-t border-white/[0.05]">
                        <td className="py-2 pr-3 text-[var(--ds-on-surface)]">{r.subject}</td>
                        <td className="py-2 pr-3"><input aria-label={`${cls} ${r.subject} periods per week`} name={`p:${r.classId}:${r.subjectId}`} type="number" min={0} max={48} defaultValue={r.periodsPerWeek ?? 5} className={SMALL} /></td>
                        <td className="py-2 pr-3"><input aria-label={`${cls} ${r.subject} double periods`} name={`d:${r.classId}:${r.subjectId}`} type="number" min={0} max={24} defaultValue={r.doublePeriods} className={SMALL} /></td>
                        <td className="py-2 pr-3"><input aria-label={`${cls} ${r.subject} room kind`} name={`k:${r.classId}:${r.subjectId}`} defaultValue={r.roomKind ?? ""} maxLength={40} placeholder="any room" className={`${INPUT} w-32`} /></td>
                        <td className="py-2 text-xs text-[var(--ds-on-surface-variant)]">{r.teachers.length ? r.teachers.join(", ") : <ToneBadge tone="warning" label="No teacher yet" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </ActionForm>
    </Panel>
  );
}

async function teachers(rules: RulesService, ps: { id: string; name: string }[]) {
  const list = await orNotFound(rules.teacherRules());
  return (
    <Panel title="2. Teacher limits and unavailability">
      <p className="mb-4 max-w-prose text-sm text-[var(--ds-on-surface-variant)]">Leave a limit blank for no limit. Tick the periods a teacher cannot teach, for example every Saturday or period 1.</p>
      {!list.length ? <WidgetEmptyState title="No teachers yet" description="Add teacher logins in Staff first." /> : (
        <ul className="flex flex-col gap-2">
          {list.map((t) => {
            const off = new Set(t.unavailable.map((u) => `${u.day}:${u.periodId}`));
            return (
              <li key={t.teacherId} className="rounded-2xl bg-white/[0.03] px-4 py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm text-[var(--ds-on-surface)]">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">{t.maxPerDay ?? "no"} a day, {t.maxPerWeek ?? "no"} a week{t.unavailable.length ? `, ${t.unavailable.length} periods off` : ""}</span>
                  </summary>
                  <ActionForm action={saveTeacherRuleAction} submitLabel="Save" className="mt-3 flex flex-col gap-3">
                    <input type="hidden" name="teacherId" value={t.teacherId} />
                    <div className="flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Max periods a day
                        <input name="maxPerDay" type="number" min={1} max={12} defaultValue={t.maxPerDay ?? ""} className={SMALL} /></label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Max periods a week
                        <input name="maxPerWeek" type="number" min={1} max={72} defaultValue={t.maxPerWeek ?? ""} className={SMALL} /></label>
                    </div>
                    <fieldset>
                      <legend className="mb-1 text-xs text-[var(--ds-on-surface-muted)]">Cannot teach (tick to block)</legend>
                      <div className="custom-scrollbar overflow-x-auto">
                        <table className="text-xs">
                          <thead><tr><th className="pr-2" />{ps.map((p) => <th key={p.id} className="px-1.5 pb-1 font-normal text-[var(--ds-on-surface-muted)]">{p.name.replace(/^Period /, "P")}</th>)}</tr></thead>
                          <tbody>{DAYS.map((d) => (
                            <tr key={d.n}><th scope="row" className="pr-2 text-left font-normal text-[var(--ds-on-surface-muted)]">{d.short}</th>
                              {ps.map((p) => <td key={p.id} className="px-1.5 py-1 text-center"><input type="checkbox" name="unavailable" value={`${d.n}:${p.id}`} defaultChecked={off.has(`${d.n}:${p.id}`)} aria-label={`${t.name} cannot teach ${d.short} ${p.name}`} className="accent-[var(--ds-primary)]" /></td>)}
                            </tr>))}</tbody>
                        </table>
                      </div>
                    </fieldset>
                  </ActionForm>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function rooms(rules: RulesService) {
  const list = await orNotFound(rules.rooms());
  return (
    <Panel title="3. Rooms and labs" action={<FormModal title="Add room" icon="class" fields={roomFields} action={addRoom} submitLabel="Add" />}>
      <p className="mb-3 max-w-prose text-sm text-[var(--ds-on-surface-variant)]">Special rooms a subject can need. Two sections never get the same room in the same period. Regular classrooms need no entry.</p>
      {!list.length ? <WidgetEmptyState title="No special rooms" description="Skip this step if no subject needs a lab or a hall." /> : (
        <ul className="flex flex-col gap-1.5">
          {list.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-[var(--ds-on-surface)]">{r.name}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--ds-on-surface-muted)]">
                <ToneBadge tone="info" label={r.kind} />{r.capacity ? `${r.capacity} seats` : ""}
                <ActionButton variant="icon-delete" label={`Remove ${r.name}`} action={removeRoom} values={{ id: r.id }}
                  confirm={{ title: `Remove ${r.name}?`, body: "Periods already booked in this room keep its name. New timetables will not use it.", confirmLabel: "Remove", danger: true }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function rulesStep(rules: RulesService) {
  const s = await orNotFound(rules.settings());
  return (
    <Panel title="4. Rules">
      <ActionForm action={saveSettingsAction} submitLabel="Save rules">
        <label className="flex items-start gap-3 text-sm text-[var(--ds-on-surface)]">
          <input type="checkbox" name="classTeacherFirstPeriod" defaultChecked={s.classTeacherFirstPeriod} className="mt-1 accent-[var(--ds-primary)]" />
          <span>Class teacher takes period 1<br /><span className="text-xs text-[var(--ds-on-surface-muted)]">When the class teacher teaches the section, their lesson goes first each day.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm text-[var(--ds-on-surface)]">
          <input type="checkbox" name="noSameSubjectTwiceADay" defaultChecked={s.noSameSubjectTwiceADay} className="mt-1 accent-[var(--ds-primary)]" />
          <span>No subject twice in a day<br /><span className="text-xs text-[var(--ds-on-surface-muted)]">Spreads each subject across the week. A double period is the exception.</span></span>
        </label>
      </ActionForm>
    </Panel>
  );
}

async function generateStep(gen: GeneratorService) {
  const [check, versions] = await orNotFound(Promise.all([gen.validate(), gen.versions()]));
  const errors = check.issues.filter((i) => i.level === "error");
  return (
    <>
      <Panel title="6. Check and generate">
        <p className="mb-3 text-sm text-[var(--ds-on-surface-variant)]">{check.sections} sections, {check.periodsPerWeek} periods to place a week.</p>
        {check.issues.length ? (
          <ul className="mb-4 flex flex-col gap-1.5" aria-label="Problems found">
            {check.issues.map((i) => (
              <li key={i.message} className="flex items-start gap-2 text-sm text-[var(--ds-on-surface)]">
                <ToneBadge tone={i.level === "error" ? "danger" : "warning"} label={i.level === "error" ? "Fix" : "Note"} /><span>{i.message}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mb-4 text-sm text-[var(--ds-on-surface-variant)]">Nothing to fix. Ready to build.</p>}
        <ActionForm action={generateDraft} submitLabel={errors.length ? "Generate anyway" : "Generate draft"} goTo="/app/timetable/generator/" disabled={!check.demands}>
          <label className="flex max-w-xs flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Seed (optional)
            <input name="seed" type="number" min={1} placeholder="random" className={INPUT} />
            <span>The same seed on the same rules gives the same timetable.</span></label>
        </ActionForm>
      </Panel>
      <div className="mt-3" />
      <Panel title="Timetables">
        {!versions.length ? <WidgetEmptyState title="Nothing generated yet" description="Drafts and the live timetable show up here." /> : (
          <ul className="flex flex-col gap-1.5">
            {versions.map((v) => (
              <li key={v.id}>
                <Link href={`/app/timetable/generator/${v.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-2.5 text-sm hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                  <span className="min-w-0 truncate text-[var(--ds-on-surface)]">{v.name}</span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--ds-on-surface-muted)]">{v.cells} periods{v.unplaced ? `, ${v.unplaced} unplaced` : ""}
                    <ToneBadge tone={v.status === "live" ? "success" : v.status === "draft" ? "info" : "default"} label={v.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
