import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { TimetableService } from "../service";
import { autoFillSection, clearSlot, setSlot } from "./actions";
import { LinkButton } from "./LinkButton";
import { NavSelect } from "./NavSelect";
import { orNotFound } from "./guard";
import { TeacherLoadPanel } from "./TeacherLoad";
import { TimetableView } from "./TimetableView";

export const metadata = { title: "Timetable" };

const HOME = "/app/timetable";
const sectionHref = (id: string) => `${HOME}?section=${id}`;

/** /app/timetable: teachers open on "My timetable"; the admin picks a section and edits; students and parents see their section. */
export default async function TimetablePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new TimetableService(ctx);
  const picked = (await searchParams).section;
  const wanted = typeof picked === "string" ? picked : undefined;
  const canManage = svc.can("manage");
  const isTeacher = ctx.role === "teacher";

  const [sections, teachers] = await Promise.all([svc.sections(), canManage ? svc.teachers() : Promise.resolve([])]);
  const mine = isTeacher && !wanted;
  const sectionId = wanted ?? (mine ? undefined : sections[0]?.id);

  if (!mine && !sectionId) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Timetable" />
        <Panel title="Timetable">
          <WidgetEmptyState title={canManage ? "No sections yet" : "No section yet"}
            description={canManage ? "Add classes and sections, then plan their week here." : "You are not in a section yet. Ask the school office."} />
          {canManage ? <div className="flex justify-center pb-4"><LinkButton href="/app/academics/classes">Set up classes</LinkButton></div> : null}
        </Panel>
      </>
    );
  }

  const timetable = await orNotFound(mine ? svc.teacherGrid(ctx.userId) : svc.sectionGrid(sectionId!));
  const [options, load] = await Promise.all([
    canManage && sectionId ? orNotFound(svc.slotOptions(sectionId)) : Promise.resolve(null),
    canManage && sectionId && timetable.periods.length ? orNotFound(svc.teacherLoad(sectionId)) : Promise.resolve(null),
  ]);
  const noTeachers = options && Object.keys(options.defaults).length === 0 && timetable.periods.length > 0;
  const choices = [...(isTeacher ? [{ href: HOME, label: "My timetable" }] : []), ...sections.map((s) => ({ href: sectionHref(s.id), label: s.label }))];

  return (
    <>
      <PageHeader eyebrow="Academics" title={mine ? "My timetable" : "Timetable"}
        description={mine ? "Your week, period by period." : canManage ? "Plan the week of each section. Teacher clashes are caught as you save." : "The week, period by period."}
        actions={<>
          {choices.length > 1 ? <NavSelect label="Show timetable of" value={mine ? HOME : sectionHref(sectionId!)} options={choices} /> : null}
          {canManage ? <NavSelect label="Teacher timetable" value="" placeholder="Teacher timetable" options={teachers.map((t) => ({ href: `${HOME}/teachers/${t.id}`, label: t.name }))} /> : null}
          {canManage ? <LinkButton href={`${HOME}/periods`}>Bell schedule</LinkButton> : null}
          {canManage && sectionId && timetable.periods.length ? <ActionButton action={autoFillSection} values={{ sectionId }} label="Auto-fill empty periods" successMessage="Empty periods filled"
            confirm={{ title: "Auto-fill empty periods?", body: "Fills every empty period from this section's subject teachers, skipping teachers who are busy. Periods you already planned stay as they are.", confirmLabel: "Auto-fill" }} /> : null}
        </>} />
      <TimetableView timetable={timetable} perspective={mine ? "teacher" : "section"} canSetUp={canManage} live={!canManage}
        notice={noTeachers ? (
          <Panel title="Set the subject teachers first">
            <p className="max-w-prose text-sm text-[var(--ds-on-surface-variant)]">This section has no subject teachers yet, so auto-fill has nobody to use. You can still pick a teacher period by period.</p>
            <div className="mt-4"><LinkButton href={`/app/academics/classes/${options.classId}`}>Open the class</LinkButton></div>
          </Panel>
        ) : undefined}
        after={load ? <TeacherLoadPanel load={load} /> : undefined}
        editor={options && sectionId ? { sectionId, options, setSlot, clearSlot } : undefined} />
    </>
  );
}
