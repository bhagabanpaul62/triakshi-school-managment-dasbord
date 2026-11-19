import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { AcademicYearService, ClassService, SectionService, SectionTeacherService, SubjectService } from "../service";
import { assignSubjects, assignTeacher, createSection, deleteClass, deleteSection, removeClassSubject, setClassTeacher, updateClass, updateSection } from "./actions";
import { assignSubjectFields, classFields, sectionFields } from "./fields";
import { MiniList } from "./mini-list";
import { RowActions } from "./row-actions";
import { TeacherMatrix } from "./teacher-matrix";
import { TeacherSelect } from "./teacher-select";

export const metadata = { title: "Class" };

const KINDS = { scholastic: "Scholastic", co_scholastic: "Co-scholastic" };

export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const classes = new ClassService(ctx);
  const cls = await classes.get(id).catch((e) => { throw e instanceof NotFoundError ? notFound() : e; });
  const [matrix, teachers, allSubjects, year] = await Promise.all([
    new SectionTeacherService(ctx).matrix(id),
    new SectionService(ctx).teacherOptions(),
    new SubjectService(ctx).options(),
    new AcademicYearService(ctx).current(),
  ]);
  const canWrite = classes.can("manage");
  const { sections, subjects, cells } = matrix;
  const taken = new Set(subjects.map((s) => s.subjectId));
  const assigned = Object.values(cells).length;
  const slots = sections.length * subjects.length;
  const sectionForm = sectionFields(teachers);
  const showFill = ctx.features.has("students");
  const hasTimetable = ctx.features.has("timetable");
  const students = sections.reduce((n, s) => n + s.students, 0);
  const seats = sections.reduce((n, s) => n + s.capacity, 0);
  const noClassTeacher = sections.filter((s) => !s.classTeacherId).length;
  const staffed = (subjectId: string) => sections.filter((s) => cells[`${s.id}:${subjectId}`]).length;

  return (
    <>
      <EntityHeader back={{ href: "/app/academics/classes", label: "Classes" }} title={cls.name}
        chips={<ToneBadge label={cls.grade <= 0 ? "Pre-primary" : `Grade ${cls.grade}`} />}
        meta={[year ? `Academic year ${year.name}` : "No current year"]}
        actions={canWrite ? <RowActions what="class" icon="class" fields={classFields} values={cls} id={cls.id} update={updateClass} remove={deleteClass}
          consequence={`${cls.name} and its sections, subjects and subject teachers will be removed.`} /> : null}
        className="pb-8" />

      <KpiRow>
        <StatCard label="Sections" value={String(sections.length)} icon={<MenuIconView name="class" />}
          meta={noClassTeacher ? `${noClassTeacher} without a class teacher` : sections.length ? "All have a class teacher" : undefined} />
        <StatCard label={showFill ? "Students" : "Seats"} value={showFill ? `${students} of ${seats}` : String(seats)} icon={<MenuIconView name="users" />} meta={showFill ? "seats filled" : undefined} />
        <StatCard label="Subjects" value={String(subjects.length)} icon={<MenuIconView name="subject" />} />
        <StatCard label="Subject teachers set" value={slots ? `${assigned} of ${slots}` : "0"} icon={<MenuIconView name="teacher" />}
          meta={slots && assigned < slots ? `${slots - assigned} still to set` : slots ? "All set" : "subject by section"} />
      </KpiRow>

      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Sections" action={canWrite && year ? <FormModal title="New section" icon="class" fields={sectionForm} action={createSection} hidden={{ classId: cls.id }} values={{ capacity: 40 }} /> : null}>
            {year ? (
              <MiniList
                empty={{ title: "No sections yet.", description: `Add Section A for ${year.name}.` }}
                items={sections.map((s) => ({
                  id: s.id,
                  title: `Section ${s.name}`,
                  meta: [s.room ? `Room ${s.room}` : "No room", showFill ? `${s.students} of ${s.capacity} seats` : `${s.capacity} seats`].join(" · "),
                  actions: <>
                    {canWrite ? <TeacherSelect label={`Class teacher of section ${s.name}`} value={s.classTeacherId ?? ""} teachers={teachers} action={setClassTeacher}
                      fields={{ sectionId: s.id }} empty="Pick class teacher" className="w-44" />
                      : <span className="text-sm text-[var(--ds-on-surface-variant)]">{s.teacherName ?? "No class teacher"}</span>}
                    {hasTimetable ? <Link href={`/app/timetable?section=${s.id}`} className="inline-flex h-10 items-center rounded-full px-3 text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Timetable</Link> : null}
                    {canWrite ? <RowActions what="section" icon="class" fields={sectionForm} values={s} id={s.id} update={updateSection} remove={deleteSection}
                      consequence={`Section ${s.name} and its subject teachers will be removed, and so will anything linked to this section.`} /> : null}
                  </>,
                }))} />
            ) : <WidgetEmptyState title="No current academic year." description="Set a current year before adding sections." />}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Subjects" action={canWrite ? <FormModal title="Assign subjects" icon="subject" fields={assignSubjectFields(allSubjects.filter((s) => !taken.has(s.value)))} action={assignSubjects} hidden={{ classId: cls.id }} submitLabel="Assign" /> : null}>
            <MiniList
              empty={{ title: "No subjects yet.", description: "Assign the subjects this class studies." }}
              items={subjects.map((s) => ({
                id: s.id,
                title: s.name,
                meta: sections.length ? `${KINDS[s.kind]} · ${staffed(s.subjectId)} of ${sections.length} sections have a teacher` : KINDS[s.kind],
                actions: canWrite ? <ActionButton variant="icon-delete" label={`Remove ${s.name} from this class`} action={removeClassSubject} values={{ id: s.id }}
                  confirm={{ title: `Remove ${s.name}?`, body: `${cls.name} stops studying ${s.name} and its subject teachers in every section are cleared.`, confirmLabel: "Remove", danger: true }} /> : null,
              }))} />
          </Panel>
        </div>
        <div className="lg:col-span-12">
          <Panel title="Subject teachers" action={canWrite && slots ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Changes save as you pick</span> : null}>
            {sections.length && subjects.length ? (
              <TeacherMatrix sections={sections.map((s) => ({ id: s.id, name: s.name }))} subjects={subjects} teachers={teachers} cells={cells} editable={canWrite} action={assignTeacher} />
            ) : <WidgetEmptyState title={sections.length ? "Assign subjects first." : "Add a section first."}
                description={sections.length ? "Use Assign subjects above, then pick who teaches each one in every section." : "Sections hold the students. Add Section A, then assign subjects and pick their teachers."} />}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
