import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { BOARDS } from "../presets";
import { SubjectService } from "../service";
import { addSubjectPreset, createSubject, deleteSubject, updateSubject } from "./actions";
import { subjectFields } from "./fields";
import { RowActions } from "./row-actions";

export const metadata = { title: "Subjects" };

const KINDS = { scholastic: "Scholastic", co_scholastic: "Co-scholastic" };
const columns: Column[] = [
  { key: "name", label: "Subject" },
  { key: "code", label: "Code", type: "mono", hideOnMobile: true },
  { key: "kind", label: "Kind", type: "badge", labels: KINDS, tones: { co_scholastic: "info" }, hideOnMobile: true },
  { key: "classes", label: "Classes", type: "number" },
  { key: "setup", label: "Teachers", type: "badge", labels: { ok: "All set", gaps: "Needs teachers", unused: "Not in a class" }, tones: { ok: "success", gaps: "warning" } },
];

export default async function SubjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SubjectService(ctx);
  const page = await svc.list({ ...listQueryFrom(await searchParams), sort: "name", dir: "asc" });
  const everyId = (await svc.options()).map((o) => o.value);
  const stats = await svc.stats(everyId);
  const rows = page.rows.map((r) => {
    const st = stats[r.id] ?? { classes: 0, teachers: 0, unstaffed: 0 };
    return { ...r, classes: st.classes, unstaffed: st.unstaffed, setup: !st.classes ? "unused" : st.unstaffed ? "gaps" : "ok" };
  });
  const all = Object.values(stats);
  const unused = all.filter((x) => !x.classes).length;
  const unstaffed = all.reduce((n, x) => n + x.unstaffed, 0);
  const staffed = all.reduce((n, x) => n + x.teachers, 0);
  const canWrite = svc.can("manage");
  const add = <FormModal title="New subject" icon="subject" fields={subjectFields} action={createSubject} values={{ kind: "scholastic" }} />;
  const presets = BOARDS.map((board) => (
    <ActionButton key={board} action={addSubjectPreset} values={{ board }} label={`Add ${board} subjects`} successMessage={`${board} subjects added`} />
  ));

  return (
    <>
      <PageHeader eyebrow="Academics" title="Subjects" description="Everything your school teaches. Open a class to give it subjects and pick who teaches them."
        actions={canWrite ? <>{presets}{add}</> : null} />
      {everyId.length ? (
        <KpiRow>
          <StatCard label="Subjects" value={String(everyId.length)} icon={<MenuIconView name="subject" />} meta="taught in your school" />
          <StatCard label="In a class" value={String(everyId.length - unused)} icon={<MenuIconView name="class" />} meta={unused ? `${unused} not in any class yet` : "Every subject is in use"} />
          <StatCard label="Gaps" value={String(unstaffed)} icon={<MenuIconView name="teacher" />} meta={unstaffed ? "subject-by-section pairs" : "Every section has its teachers"} />
          <StatCard label="Teachers set" value={String(staffed)} icon={<MenuIconView name="users" />} meta={`of ${staffed + unstaffed} subject by section`} />
        </KpiRow>
      ) : null}
      <DataTable
        columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
        searchPlaceholder="Search subjects"
        filters={[{ key: "kind", label: "Kind", options: Object.entries(KINDS).map(([value, label]) => ({ value, label })) }]}
        empty={{ title: "No subjects yet.", description: "Start from your board's common subjects, or add your own.", action: canWrite ? <div className="flex flex-wrap gap-2">{presets}{add}</div> : undefined }}
        rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id,
          <RowActions key={r.id} what="subject" icon="subject" fields={subjectFields} values={r} id={r.id} update={updateSubject} remove={deleteSubject}
            consequence={`${r.name} will be removed from every class and from all subject teacher assignments.`} />])) : undefined}
      />
    </>
  );
}
