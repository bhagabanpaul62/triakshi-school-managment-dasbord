import { listQueryFrom, type Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { ProgressList } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { shortDate } from "@smw/ui/format";
import { AssignmentService } from "../service";
import { toIstInput, turnedIn } from "../rules";
import { createAssignment, deleteAssignment, updateAssignment } from "./actions";
import { assignmentFields } from "./fields";
import { STATE_LABEL, STATE_TONE } from "./shared";

const columns: Column[] = [
  { key: "title", label: "Assignment" },
  { key: "where", label: "Class and subject" },
  { key: "dueAt", label: "Due", type: "date" },
  { key: "handedIn", label: "Handed in" },
  { key: "status", label: "Status", type: "badge", tones: STATE_TONE, labels: STATE_LABEL },
];

const icon = (name: string) => <MenuIconView name={name} className="h-4 w-4" />;

/** Teacher and admin home for assignments: numbers that need action, progress per assignment, the full list. */
export async function TeacherList({ ctx, searchParams }: { ctx: Ctx; searchParams: Record<string, string | string[] | undefined> }) {
  const svc = new AssignmentService(ctx);
  const [page, summary, options] = await Promise.all([svc.listWithStats(listQueryFrom(searchParams)), svc.summary(), svc.options()]);
  const fields = assignmentFields(options);
  const canCreate = svc.can("write") && options.sections.length > 0;
  const now = Date.now();
  // Smart defaults: published, due 5 pm in two days, and the section pre-picked when the teacher has only one.
  const defaults = { status: "published", dueAt: `${toIstInput(new Date(now + 2 * 86_400_000)).slice(0, 10)}T17:00`, sectionId: options.sections.length === 1 ? options.sections[0]!.value : "" };
  const create = <FormModal title="New assignment" icon="assignment" fields={assignmentFields(options, true)} action={createAssignment} submitLabel="Post assignment" values={defaults}
    summary="Students see it as soon as it is posted" />;

  const rows = page.rows.map((r) => ({ ...r, where: `${r.sectionLabel} · ${r.subjectName}`, handedIn: r.progress.total ? `${r.progress.total - r.progress.missing}/${r.progress.total}` : null }));
  const progress = page.rows.map((r) => {
    const done = r.progress.total - r.progress.missing;
    const overdueWithGaps = r.dueAt.getTime() < now && r.progress.missing > 0;
    return {
      id: r.id, label: r.title, meta: `${r.sectionLabel} · ${r.subjectName} · due ${shortDate(r.dueAt)}`,
      value: `${done}/${r.progress.total}`, progress: turnedIn(r.progress), href: `/app/assignments/${r.id}`,
      tone: r.progress.total > 0 && r.progress.missing === 0 ? "success" as const : overdueWithGaps ? "warning" as const : "info" as const,
    };
  });

  return (
    <>
      <PageHeader eyebrow="Academics" title="Assignments" description="Give homework, collect it and grade it." actions={canCreate ? create : null} />
      <KpiRow>
        <StatCard label="Open" value={String(summary.open)} icon={icon("assignment")} meta="published, not yet due" />
        <StatCard label="Due in 7 days" value={String(summary.dueSoon)} icon={icon("calendar")} meta="plan your marking" />
        <StatCard label="To grade" value={String(summary.toGrade)} icon={icon("check")} meta="handed in, not marked" />
        <StatCard label="Missing" value={String(summary.missing)} icon={icon("clock")} meta="past due, nothing handed in" />
      </KpiRow>
      <PanelGrid>
        <div className="lg:col-span-4">
          <Panel title="Submission progress">
            <ProgressList items={progress} maxItems={8} empty={{ title: "Nothing to track yet.", description: "You will see who has handed in once homework is posted." }} />
          </Panel>
        </div>
        <div className="min-w-0 lg:col-span-8">
          <div className="relative min-w-0 overflow-x-clip">
            <DataTable
              columns={columns}
              rows={rows}
              total={page.total}
              page={page.page}
              pageCount={page.pageCount}
              rowHref="/app/assignments/{id}"
              searchPlaceholder="Search assignments"
              filters={[
                { key: "status", label: "Status", options: [{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "closed", label: "Closed" }] },
                { key: "sectionId", label: "Section", options: options.sections },
                { key: "subjectId", label: "Subject", options: options.subjects },
              ]}
              empty={{ title: "No assignments yet.", description: canCreate ? "Create one to give homework to a section." : "You are not assigned to a class and subject yet. Ask an admin to add you in Classes, then you can post homework here.", action: canCreate ? create : undefined }}
              rowActions={canCreate ? Object.fromEntries(rows.map((r) => [r.id, (
                <span key={r.id} className="inline-flex items-center gap-1">
                  <FormModal title="Edit assignment" icon="assignment" fields={fields} values={{ ...r, dueAt: toIstInput(r.dueAt), maxMarks: r.maxMarks ?? "" }} hidden={{ id: r.id }} action={updateAssignment}
                    trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
                  <ActionButton variant="icon-delete" label={`Delete ${r.title}`} action={deleteAssignment} values={{ id: r.id }}
                    confirm={{ title: "Delete this assignment?", body: `"${r.title}", its files and every submission will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
                </span>
              )])) : undefined}
            />
          </div>
        </div>
      </PanelGrid>
    </>
  );
}
