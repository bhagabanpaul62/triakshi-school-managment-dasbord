import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import Link from "next/link";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Button } from "@smw/ui/ui/button";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ExamService } from "../service";
import { EXAM_STATUSES } from "../schema";
import { createExam, deleteExam, updateExam } from "./actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, examFields, paperFields } from "./shared";

export const metadata = { title: "Exams" };

const columns: Column[] = [
  { key: "name", label: "Exam" },
  { key: "kind", label: "Type", type: "badge", labels: KIND_LABEL, hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", labels: STATUS_LABEL, tones: STATUS_TONE },
  { key: "startsOn", label: "Starts", type: "date" },
  { key: "endsOn", label: "Ends", type: "date", hideOnMobile: true },
  { key: "papers", label: "Papers", type: "number", hideOnMobile: true },
];

export default async function ExamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new ExamService(ctx);
  const canManage = svc.can("manage");
  const [page, options] = await Promise.all([svc.listWithPapers(listQueryFrom(await searchParams)), svc.formOptions()]);
  const current = options.years.find((y) => y.isCurrent)?.value ?? options.years[0]?.value;
  const base = examFields(options);
  // Smart defaults: every class sits it, two weeks from today, a week long.
  const day = (plus: number) => new Date(Date.now() + plus * 864e5).toISOString().slice(0, 10);
  const create = canManage ? (
    <FormModal title="New exam" icon="exam" size="lg" fields={[...base, ...paperFields(options)]} action={createExam} submitLabel="Create exam"
      values={{ kind: "half_yearly", yearId: current, startsOn: day(14), endsOn: day(21), classIds: options.classes.map((c) => c.value), maxMarks: 80, passMarks: 27 }}
      summary="Papers are made for every chosen class and subject. Untick classes that do not sit it." />
  ) : null;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Exams" description="Create an exam, collect marks paper by paper, then publish results." actions={<>
        {canManage ? <Button asChild variant="secondary" className="rounded-full"><Link href="/app/exams/weights">Term weights</Link></Button> : null}
        {canManage ? <Button asChild variant="secondary" className="rounded-full"><Link href="/app/exams/scales">Report setup</Link></Button> : null}
        {create}
      </>} />
      <DataTable
        columns={columns}
        rows={page.rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        rowHref="/app/exams/{id}"
        searchPlaceholder="Search exams"
        filters={[{ key: "status", label: "Status", options: EXAM_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) }]}
        empty={{ title: "No exams yet.", description: canManage ? "Create one and pick the classes and subjects. The papers are made for you." : "Exams will show here once the school creates them.", action: create ?? undefined }}
        rowActions={canManage ? Object.fromEntries(page.rows.filter((r) => r.status !== "published").map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            <FormModal title="Edit exam" icon="exam" fields={base} values={r} hidden={{ id: r.id }} action={updateExam} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label={`Delete ${r.name}`} action={deleteExam} values={{ id: r.id }}
              confirm={{ title: "Delete this exam?", body: `"${r.name}" with its ${r.papers} papers and every mark entered will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
          </span>
        )])) : undefined}
      />
    </>
  );
}
