import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Button } from "@smw/ui/ui/button";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { LABEL, ProgressList, ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { ExamService, type ExamDetail } from "../service";
import { addPapers, removePaper, transitionExam } from "./actions";
import { ErrorPanel, KIND_LABEL, STATUS_LABEL, STATUS_TONE, attempt, paperFields } from "./shared";

export const metadata = { title: "Exam" };

const columns: Column[] = [
  { key: "className", label: "Class" },
  { key: "subjectName", label: "Subject" },
  { key: "date", label: "Date", type: "date" },
  { key: "maxMarks", label: "Max", type: "number" },
  { key: "passMarks", label: "Pass", type: "number", hideOnMobile: true },
  { key: "progress", label: "Marks in", type: "text" },
];

/** The one next step for an exam: what is true now, why, and the button that moves it on. */
function nextStep(d: ExamDetail, canManage: boolean) {
  const { exam, totals, papers } = d;
  const mine = papers.filter((p) => p.canEnter && p.entered < p.students);
  if (!canManage) {
    if (exam.status === "marks_open") return mine.length
      ? { title: `${mine.length} of your ${mine.length === 1 ? "paper needs" : "papers need"} marks`, body: "Open a paper below and type the marks. Enter moves to the next student.", href: `/app/exams/${exam.id}/marks/${mine[0]!.id}`, hrefLabel: "Enter marks" }
      : { title: "Your marks are all in", body: "The school publishes results when every class is done." };
    return { title: STATUS_LABEL[exam.status], body: exam.status === "published" ? "Marks are locked and results are visible to students and parents." : "Marks entry opens once the school is ready." };
  }
  if (exam.status === "draft") return { title: "Schedule this exam", body: `${totals.papers} papers are ready. Students and parents see nothing until you publish.`, to: "scheduled", label: "Schedule exam", force: false, confirm: undefined };
  if (exam.status === "scheduled") return { title: "Open marks entry when the exams are done", body: "Teachers can type marks for the subjects they teach as soon as it opens.", to: "marks_open", label: "Open marks entry", force: false, confirm: undefined };
  if (exam.status === "marks_open") {
    const missing = totals.missing > 0;
    return {
      title: missing ? `${totals.missing} marks are still missing` : "All marks are in",
      body: missing ? `Marks are still missing across ${papers.filter((p) => p.entered < p.students).length} papers. Publishing now shows them as pending to students and parents, and locks marks entry for good.` : "Publish to show results to students and parents. Marks entry locks for good.",
      to: "published", label: missing ? "Publish anyway" : "Publish results", force: missing,
      confirm: { title: missing ? "Publish with marks missing?" : "Publish these results?", confirmLabel: "Publish", danger: false,
        body: `Students and parents will see the results and marks entry locks for good.${missing ? ` ${totals.missing} marks are still missing and will show as pending.` : ""}` },
    };
  }
  return { title: "Results are published", body: "Students and parents can see them. Marks are locked.", href: `/app/results?examId=${exam.id}`, hrefLabel: "View class results" };
}

export default async function ExamDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, requireCtx()]);
  const svc = new ExamService(ctx);
  const loaded = await attempt(async () => ({ detail: await svc.detail(id), options: await svc.formOptions() }));
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { detail: d, options } = loaded.data;
  const { exam, papers, totals } = d;
  const canManage = svc.can("manage");
  const step = nextStep(d, canManage);
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.toLowerCase();
  const rows = papers
    .filter((p) => canManage || p.canEnter)
    .filter((p) => !q || `${p.className} ${p.subjectName}`.toLowerCase().includes(q))
    .map((p) => ({ ...p, progress: `${Math.min(p.entered, p.students)} of ${p.students}` }));
  const todo = [...papers].filter((p) => p.canEnter).sort((a, b) => (b.students - b.entered) - (a.students - a.entered));
  const classes = new Set(papers.map((p) => p.classId)).size;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/exams", label: "Exams" }}
        title={exam.name}
        chips={<><ToneBadge label={STATUS_LABEL[exam.status]} tone={STATUS_TONE[exam.status]} /><ToneBadge label={KIND_LABEL[exam.kind]} /></>}
        meta={[d.yearName, d.termName, `${shortDate(exam.startsOn)} to ${shortDate(exam.endsOn)}`]}
        actions={canManage ? (
          <>
            {exam.status !== "published" ? (
              <FormModal title="Add papers" icon="exam" fields={paperFields(options, "")} action={addPapers} hidden={{ examId: exam.id }} values={{ maxMarks: 80, passMarks: 27 }}
                trigger={{ label: "Add papers", variant: "secondary" }} successMessage="Papers added" />
            ) : null}
          </>
        ) : null}
        className="pb-8"
      />

      <Panel className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className={LABEL}>Next step</p>
            <p className="mt-1 text-[15px] font-medium text-[var(--ds-on-surface)]">{step.title}</p>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ds-on-surface-variant)]">{step.body}</p>
          </div>
          {"to" in step && step.to ? (
            <ActionButton variant="default" label={step.label} action={transitionExam} values={{ id: exam.id, to: step.to, force: step.force ? "true" : "" }} confirm={step.confirm}>{step.label}</ActionButton>
          ) : "href" in step && step.href ? (
            <Button asChild className="rounded-full"><Link href={step.href}>{step.hrefLabel}</Link></Button>
          ) : null}
        </div>
      </Panel>

      <KpiRow>
        <StatCard label="Papers" value={String(totals.papers)} meta={`${classes} ${classes === 1 ? "class" : "classes"}`} />
        <StatCard label="Marks entered" value={`${totals.percent}%`} meta={`${totals.entered} of ${totals.slots}`} />
        <StatCard label="Marks missing" value={String(totals.missing)} meta={totals.missing ? "Needed before publishing" : "All in"} />
        <StatCard label="Papers complete" value={String(papers.filter((p) => p.students > 0 && p.entered >= p.students).length)} meta={`of ${totals.papers}`} />
      </KpiRow>

      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Marks entry by paper">
            <ProgressList
              maxItems={8}
              items={todo.map((p) => ({
                id: p.id, label: `${p.className} · ${p.subjectName}`, value: `${Math.min(p.entered, p.students)}/${p.students}`,
                progress: p.students ? (p.entered / p.students) * 100 : 0, tone: p.students > 0 && p.entered >= p.students ? "success" : "info",
                href: `/app/exams/${exam.id}/marks/${p.id}`,
              }))}
              empty={{ title: papers.length ? "No papers for you." : "No papers yet.", description: papers.length ? "You can enter marks only for subjects you teach." : "Add papers to start collecting marks." }}
            />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Details">
            <FactList>
              <Fact label="Academic year">{d.yearName}</Fact>
              <Fact label="Term">{d.termName}</Fact>
              <Fact label="Starts">{shortDate(exam.startsOn)}</Fact>
              <Fact label="Ends">{shortDate(exam.endsOn)}</Fact>
              <Fact label="Type">{KIND_LABEL[exam.kind]}</Fact>
              <Fact label="Results">{exam.status === "published" ? "Visible to students and parents" : "Hidden until published"}</Fact>
            </FactList>
          </Panel>
        </div>
      </PanelGrid>

      <div className="mt-3">
        <DataTable
          columns={columns}
          rows={rows}
          total={rows.length}
          page={1}
          pageCount={1}
          searchPlaceholder="Search class or subject"
          empty={{ title: "No papers yet.", description: "Add papers for the classes and subjects that sit this exam." }}
          rowActions={Object.fromEntries(rows.map((p) => [p.id, (
            <span key={p.id} className="inline-flex items-center gap-1">
              {p.canEnter ? (
                <Button asChild variant="ghost" size="sm" className="rounded-full">
                  <Link href={`/app/exams/${exam.id}/marks/${p.id}`}>{exam.status === "marks_open" ? "Enter marks" : "View marks"}</Link>
                </Button>
              ) : null}
              {canManage && exam.status !== "published" && p.entered === 0 ? (
                <ActionButton variant="icon-delete" label={`Remove ${p.className} ${p.subjectName} paper`} action={removePaper} values={{ id: p.id }}
                  confirm={{ title: "Remove this paper?", body: `${p.className} ${p.subjectName} will no longer be part of this exam.`, confirmLabel: "Remove", danger: true }} />
              ) : null}
            </span>
          )]))}
        />
      </div>
    </>
  );
}
