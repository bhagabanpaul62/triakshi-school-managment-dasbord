import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { TimetableService } from "../service";
import { LinkButton } from "./LinkButton";
import { NavSelect } from "./NavSelect";
import { orNotFound } from "./guard";
import { TimetableView } from "./TimetableView";

export const metadata = { title: "Teacher timetable" };

/** /app/timetable/teachers/[id]: one teacher's week, read-only. Staff only; students and parents get the 404 page. */
export default async function TeacherTimetablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const svc = new TimetableService(ctx);
  const [timetable, teachers] = await orNotFound(Promise.all([svc.teacherGrid(id), svc.teachers()]));
  return (
    <>
      <PageHeader eyebrow="Timetable" title={timetable.title} description="This teacher's week, with the section of each period."
        actions={<>
          <NavSelect label="Switch teacher" value={`/app/timetable/teachers/${id}`} options={teachers.map((t) => ({ href: `/app/timetable/teachers/${t.id}`, label: t.name }))} />
          <LinkButton href="/app/timetable">All timetables</LinkButton>
        </>} />
      <TimetableView timetable={timetable} perspective="teacher" canSetUp={svc.can("manage")} />
    </>
  );
}
