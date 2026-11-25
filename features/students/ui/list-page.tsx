import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Inset } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { Button } from "@smw/ui/ui/button";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { StudentService } from "../service";
import { createStudent } from "./actions";
import { StudentModal } from "./student-modal";
import { GENDER_OPTIONS, STATUS_OPTIONS, studentFields } from "./fields";

export const metadata = { title: "Students" };

const columns: Column[] = [
  { key: "name", label: "Student", type: "person", metaKey: "admissionNo" },
  { key: "classSection", label: "Class" },
  { key: "rollNo", label: "Roll", type: "number", hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", tones: { active: "success", joining: "info", alumni: "info", left: "warning" } },
  { key: "joinsOn", label: "Joins", type: "date", hideOnMobile: true },
  { key: "guardianPhone", label: "Guardian phone", type: "mono", hideOnMobile: true },
];

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new StudentService(ctx);
  // A role with no student access gets a plain page, not the error page.
  if (!svc.can("read") && !svc.can("self")) return <NoAccess title="Student records are kept by the office." hint="Ask your school admin if you need to see them." />;
  const canWrite = svc.can("write");
  const canEdit = canWrite && !ctx.readOnly; // a read-only school or support session sees the list without the buttons that change it
  const query = listQueryFrom(await searchParams);
  if (!query.sort) Object.assign(query, { sort: "name", dir: "asc" });

  const [page, look, stats] = await Promise.all([svc.listView(query), svc.lookups(), canWrite ? svc.stats() : null]);
  const sectionOptions = look.sections.map((s) => ({ value: s.id, label: s.label }));
  const j = look.joining;
  const age = {
    classes: Object.fromEntries(j.classes.map((c) => [c.id, { name: c.name, grade: c.grade }])),
    sectionClass: Object.fromEntries([...look.sections, ...j.sections].map((x) => [x.id, x.classId])),
  };
  const admit = (
    <StudentModal title="Admit student" icon="users" fields={studentFields(sectionOptions, "admit", {
      classes: j.classes.map((c) => ({ value: c.id, label: c.name })), years: j.years.map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (this year)` : y.name })),
      sections: j.sections.map((x) => ({ value: x.id, label: x.label })),
    })} action={createStudent} submitLabel="Admit" values={{ guardianRelation: "father", guardian2Relation: "mother" }} age={age}
      intro="Creates the student login and the class enrolment. A child who starts later gets a login that switches on that day." />
  );
  const capacity = stats?.capacity;

  return (
    <>
      <PageHeader eyebrow="People" title="Students"
        description={ctx.role === "student" ? "Your student record." : "Everyone enrolled, by class and section."}
        actions={canEdit ? (<>
          <Button asChild variant="secondary" className="rounded-full"><Link href="/app/students/credentials">Login slips</Link></Button>
          <Button asChild variant="secondary" className="rounded-full"><Link href="/app/students/import">Import CSV</Link></Button>
          <Button asChild variant="secondary" className="rounded-full"><Link href="/app/students/promote">Promote</Link></Button>
          {admit}
        </>) : null} />

      {capacity && stats ? (
        <>
          <KpiRow>
            <StatCard label="Active students" value={String(capacity.active)} meta={`${capacity.cap} allowed on your plan`} />
            <StatCard label="Plan used" value={`${capacity.percent}%`} meta={capacity.warning ? "Time to upgrade" : "Room to grow"} />
            <StatCard label="Alumni" value={String(stats.alumni)} meta="Graduated" />
            <StatCard label="Joining later" value={String(stats.joining)} meta="Accepted, not started. Not counted against the plan" />
            <StatCard label="Left school" value={String(stats.left)} meta="Not counted against the plan" />
          </KpiRow>
          {capacity.message ? (
            <Inset className="mb-3 flex flex-wrap items-center gap-3">
              <ToneBadge label={capacity.blocked ? "Admissions blocked" : "Plan limit"} tone={capacity.blocked ? "danger" : "warning"} />
              <p className="text-sm text-[var(--ds-on-surface-variant)]">{capacity.message}</p>
            </Inset>
          ) : null}
        </>
      ) : null}

      {canEdit && j.notice ? (
        <Inset className="mb-3 flex flex-wrap items-center gap-3">
          <ToneBadge label="Next year" tone="info" />
          <p className="text-sm text-[var(--ds-on-surface-variant)]">{j.notice} <Link href={j.years.every((y) => y.isCurrent) ? "/app/academics/years" : "/app/academics/classes"} className="underline underline-offset-4">{j.years.every((y) => y.isCurrent) ? "Add next year" : "Set up classes and sections"}</Link></p>
        </Inset>
      ) : null}

      <DataTable
        columns={columns}
        rows={page.rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        rowHref="/app/students/{id}"
        searchPlaceholder="Search by name or admission number"
        filters={ctx.role === "student" ? [] : [
          { key: "classId", label: "Class", options: look.classes.map((c) => ({ value: c.id, label: c.name })) },
          { key: "sectionId", label: "Section", options: sectionOptions },
          { key: "status", label: "Status", options: STATUS_OPTIONS },
          { key: "gender", label: "Gender", options: GENDER_OPTIONS },
        ]}
        empty={{
          title: canWrite ? "No students yet." : "No students to show.",
          description: canWrite ? "Admit the first student, or import a CSV of the whole school." : "Students you can see will appear here.",
          action: canEdit ? admit : undefined,
        }}
      />
    </>
  );
}
