import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ClassService } from "../service";
import { addClassPresets, createClass, deleteClass, updateClass } from "./actions";
import { classFields } from "./fields";
import { RowActions } from "./row-actions";

export const metadata = { title: "Classes" };

const columns: Column[] = [
  { key: "name", label: "Class" },
  { key: "sections", label: "Sections", type: "number", hideOnMobile: true },
  { key: "seats", label: "Students", hideOnMobile: true },
  { key: "subjects", label: "Subjects", type: "number", hideOnMobile: true },
  { key: "setup", label: "Setup", type: "badge", labels: { ready: "Ready", gaps: "Needs teachers", empty: "Add sections" }, tones: { gaps: "warning", empty: "warning", ready: "success" } },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function ClassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new ClassService(ctx);
  const page = await svc.list({ ...listQueryFrom(await searchParams), sort: "grade", dir: "asc" });
  const stats = await svc.stats(page.rows.map((c) => c.id));
  const canWrite = svc.can("manage");
  const rows = page.rows.map((c) => {
    const st = stats[c.id]!;
    const setup = !st.sections ? "empty" : st.noClassTeacher || st.unstaffed ? "gaps" : "ready";
    return { ...c, ...st, setup, seats: st.sections ? `${st.students} of ${st.capacity}` : null };
  });
  const total = rows.reduce((t, r) => ({ sections: t.sections + r.sections, capacity: t.capacity + r.capacity, students: t.students + r.students, noClassTeacher: t.noClassTeacher + r.noClassTeacher, unstaffed: t.unstaffed + r.unstaffed }), { sections: 0, capacity: 0, students: 0, noClassTeacher: 0, unstaffed: 0 });
  const gaps = total.noClassTeacher + total.unstaffed;
  const add = <FormModal title="New class" icon="class" fields={classFields} action={createClass} values={{ grade: 1 }} />;
  const presets = <ActionButton action={addClassPresets} label="Add Indian presets" successMessage="Preset classes added">Add Nursery to Class 12</ActionButton>;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Classes" description="Open a class to see its sections, subjects and who teaches what."
        actions={canWrite ? <>{presets}{add}</> : null} />
      {page.total > 0 ? (
        <KpiRow>
          <StatCard label="Classes" value={String(page.total)} icon={<MenuIconView name="class" />} meta={`${rows[0]!.name} to ${rows[rows.length - 1]!.name}`} />
          <StatCard label="Sections" value={String(total.sections)} icon={<MenuIconView name="class" />} meta="this academic year" />
          <StatCard label="Students" value={String(total.students)} icon={<MenuIconView name="users" />} meta={`of ${total.capacity} seats filled`} />
          <StatCard label="Gaps" value={String(gaps)} icon={<MenuIconView name="teacher" />}
            meta={gaps ? [total.noClassTeacher ? `${plural(total.noClassTeacher, "section")} without a class teacher` : "", total.unstaffed ? `${plural(total.unstaffed, "subject")} without a teacher` : ""].filter(Boolean).join(" · ") : "Every section is staffed"} />
        </KpiRow>
      ) : null}
      <DataTable
        columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
        rowHref="/app/academics/classes/{id}" searchPlaceholder="Search classes"
        empty={{ title: "No classes yet.", description: "Add Nursery to Class 12 in one click, or create your own.", action: canWrite ? <div className="flex gap-2">{presets}{add}</div> : undefined }}
        rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id,
          <RowActions key={r.id} what="class" icon="class" fields={classFields} values={r} id={r.id} update={updateClass} remove={deleteClass}
            consequence={`${r.name} and its sections, subjects and subject teachers will be removed, and so will anything that hangs off its sections.`} />])) : undefined}
      />
    </>
  );
}
