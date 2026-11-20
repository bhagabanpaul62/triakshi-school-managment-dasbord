import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { istDate } from "../bell";
import { GeneratorService } from "../generator-service";
import { TimetableService } from "../service";
import { discardDraft, generateDraft, publishDraft, setLocked, clearSlot, setSlot, unscheduleDraft } from "./actions";
import { LinkButton } from "./LinkButton";
import { NavSelect } from "./NavSelect";
import { orNotFound } from "./guard";
import { TimetableView } from "./TimetableView";

export const metadata = { title: "Review timetable" };

/** /app/timetable/generator/[id]: a draft (or any version) per section and per teacher, what could not be placed, and the buttons to publish. */
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const gen = new GeneratorService(ctx);
  const tt = new TimetableService(ctx);
  const review = await orNotFound(gen.review(id));
  const v = review.version;
  const draft = v.status === "draft";
  const tomorrow = istDate(new Date(Date.now() + 86_400_000));
  const base = `/app/timetable/generator/${id}`;
  const teacherId = typeof sp.teacher === "string" ? sp.teacher : undefined;
  const sectionId = typeof sp.section === "string" ? sp.section : review.sections[0]?.id;
  const timetable = await orNotFound(teacherId ? tt.teacherGrid(teacherId, id) : sectionId ? tt.sectionGrid(sectionId, id) : Promise.resolve(null));
  const [options, load] = draft && sectionId && !teacherId && timetable?.periods.length
    ? await orNotFound(Promise.all([tt.slotOptions(sectionId, id), tt.teacherLoad(sectionId, id)])) : [null, null];
  const stats = (v.unplaced ? v.unplaced : 0);
  const choices = [
    ...review.sections.map((s) => ({ href: `${base}?section=${s.id}`, label: s.label })),
  ];

  return (
    <>
      <PageHeader eyebrow="Timetable generator" title={v.name}
        description={draft && v.publishOn ? `A draft, scheduled to go live on ${v.publishOn}. You can still edit it.` : draft ? "A draft: nobody sees it until you publish. Edit cells, pin the ones you like, and re-run the rest." : v.status === "live" ? "This is the live timetable." : "An old timetable, kept for reference."}
        actions={<>
          <LinkButton href="/app/timetable/generator?step=5">All timetables</LinkButton>
          {draft ? <>
            <ActionButton action={setLocked} values={{ versionId: id, locked: "true" }} label="Pin all" successMessage="Pinned" />
            <ActionButton action={generateDraft} values={{ versionId: id }} label="Re-run, keep pinned" successMessage="Rebuilt"
              confirm={{ title: "Rebuild the unpinned periods?", body: "Pinned periods stay exactly as they are. Every other period is generated again.", confirmLabel: "Re-run" }} />
            <ActionButton action={discardDraft} values={{ versionId: id }} label="Discard" redirectTo="/app/timetable/generator?step=5"
              confirm={{ title: "Discard this draft?", body: "The draft is deleted. The live timetable is not touched.", confirmLabel: "Discard", danger: true }} />
            {v.publishOn ? <ActionButton action={unscheduleDraft} values={{ versionId: id }} label="Unschedule" /> : null}
            <FormModal title="Publish this timetable" icon="calendar" size="md" action={publishDraft} hidden={{ versionId: id }} values={{ publishOn: v.publishOn ?? "" }}
              trigger={{ label: v.publishOn ? "Change date" : "Publish", variant: "default" }} submitLabel="Publish"
              description={`Leave the date empty to publish now: everyone sees it at once and the current live timetable is archived. Pick a later day and it goes live that morning; until then it stays a draft you can still edit.${v.unplaced ? ` ${v.unplaced} periods could not be placed and will be empty.` : ""}`}
              fields={[{ name: "publishOn", label: "Go live on", type: "date", min: tomorrow, hint: "Optional. Empty means now." }]} />
          </> : null}
        </>} />
      <KpiRow>
        <StatCard label="Periods placed" value={String(v.cells)} icon={<MenuIconView name="clock" />} />
        <StatCard label="Not placed" value={String(stats)} icon={<MenuIconView name="calendar" />} meta={stats ? "See the list below" : "Everything fit"} />
        <StatCard label="Sections" value={String(review.sections.length)} icon={<MenuIconView name="class" />} />
        <StatCard label="Teachers used" value={String(review.teachers.length)} icon={<MenuIconView name="teacher" />} />
      </KpiRow>
      {review.unplaced.length ? (
        <div className="mb-3">
          <Panel title={`Could not place (${review.unplaced.length})`}>
            <ul className="flex flex-col gap-2">
              {review.unplaced.map((u) => (
                <li key={u.demandId} className="flex flex-col gap-0.5 rounded-2xl bg-white/[0.03] px-4 py-2.5 text-sm">
                  <span className="text-[var(--ds-on-surface)]">{u.section}: {u.subject}, {u.missing} {u.missing === 1 ? "period" : "periods"} short <ToneBadge tone="warning" label={u.teacher} /></span>
                  <span className="text-xs text-[var(--ds-on-surface-variant)]">{u.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
      {!timetable ? <Panel title="Timetable"><WidgetEmptyState title="No sections" description="Add classes and sections first." /></Panel> : (
        <TimetableView timetable={timetable} perspective={teacherId ? "teacher" : "section"} canSetUp={false}
          action={<div className="flex flex-wrap gap-2">
            <NavSelect label="Show section" value={teacherId ? "" : `${base}?section=${sectionId}`} placeholder="Section" options={choices} />
            <NavSelect label="Show teacher" value={teacherId ? `${base}?teacher=${teacherId}` : ""} placeholder="Teacher" options={review.teachers.map((t) => ({ href: `${base}?teacher=${t.id}`, label: `${t.name} (${t.periods})` }))} />
          </div>}
          editor={options && sectionId ? { sectionId, options, setSlot, clearSlot, versionId: id, lock: setLocked } : undefined}
          after={load ? <Panel title="Teacher load"><ul className="flex flex-col gap-1">{load.teachers.map((t) => <li key={t.id} className="flex justify-between text-sm text-[var(--ds-on-surface)]"><span>{t.name}</span><span className="text-[var(--ds-on-surface-muted)]">{t.here} here, {t.total} in all, of {load.max}</span></li>)}</ul></Panel> : undefined} />
      )}
    </>
  );
}
