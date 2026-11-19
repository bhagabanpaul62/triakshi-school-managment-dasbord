import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { BigStat, StatGroup } from "@smw/ui/kit/BigStat";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { Button } from "@smw/ui/ui/button";
import { EntityList, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { ResultService } from "../service";
import { ResultPicker } from "./result-picker";
import { ErrorPanel, RESULT_LABEL, RESULT_TONE, STATUS_LABEL, attempt, marksText } from "./shared";

export const metadata = { title: "Results" };

const columns: Column[] = [
  { key: "rank", label: "Rank", type: "number", width: "72px" },
  { key: "name", label: "Student", type: "person", metaKey: "roll" },
  { key: "totalText", label: "Total", hideOnMobile: true },
  { key: "percentText", label: "Percent", type: "text" },
  { key: "grade", label: "Grade", type: "badge" },
  { key: "result", label: "Result", type: "badge", labels: RESULT_LABEL, tones: RESULT_TONE },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Students and parents: their published results. Staff: pick an exam and a section. */
export default async function ResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, ctx] = await Promise.all([searchParams, requireCtx()]);
  const svc = new ResultService(ctx);
  return svc.can("read") ? <StaffResults svc={svc} sp={sp} /> : <MyResults svc={svc} />;
}

async function MyResults({ svc }: { svc: ResultService }) {
  const loaded = await attempt(() => svc.mine());
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  return (
    <>
      <PageHeader eyebrow="Academics" title="Results" description="Published exam results. Tap an exam to see every subject and download the report card." />
      {loaded.data.length === 0 ? <Panel><WidgetEmptyState title="No results yet." description="Results show here as soon as the school publishes them." /></Panel> : (
        <div className="flex flex-col gap-3">
          {loaded.data.map((kid) => (
            <Panel key={kid.student.id} title={`${kid.student.name} · ${kid.student.className}-${kid.student.sectionName}`}>
              {kid.items[0] ? (
                <StatGroup columns={3} className="mb-4">
                  <BigStat label="Latest" value={kid.items[0].percent === null ? "-" : `${kid.items[0].percent}%`} hint={kid.items[0].examName} />
                  <BigStat label="Grade" value={kid.items[0].grade ?? "-"} hint={RESULT_LABEL[kid.items[0].result]} tone={RESULT_TONE[kid.items[0].result] === "success" ? "success" : "default"} />
                  <BigStat label="Rank" value={kid.items[0].rank ? String(kid.items[0].rank) : "-"} hint={kid.items[0].rank ? `of ${kid.items[0].sectionSize}` : undefined} />
                </StatGroup>
              ) : null}
              <EntityList maxItems={20}
                empty={{ title: "Nothing published yet.", description: "Results appear here after the exam is published." }}
                items={kid.items.map((i) => ({
                  id: i.examId, title: i.examName, subtitle: shortDate(i.startsOn), href: `/app/results/${i.examId}/${kid.student.id}`,
                  badge: <ToneBadge label={i.grade ? `Grade ${i.grade}` : RESULT_LABEL[i.result]} tone={RESULT_TONE[i.result]} />,
                  meta: [i.percent === null ? null : `${i.percent}%`, i.rank ? `Rank ${i.rank} of ${i.sectionSize}` : null].filter(Boolean).join(" · "),
                }))} />
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

async function StaffResults({ svc, sp }: { svc: ResultService; sp: Record<string, string | string[] | undefined> }) {
  const q = one(sp.q)?.toLowerCase();
  const loaded = await attempt(async () => {
    // Smart defaults: the latest published exam (else the latest exam) and its first section.
    const all = await svc.options();
    const examId = one(sp.examId) ?? (all.exams.find((e) => e.status === "published") ?? all.exams[0])?.id;
    const options = examId ? await svc.options(examId) : all;
    const sectionId = one(sp.sectionId) ?? options.sections[0]?.id;
    return { options, examId, sectionId, data: examId && sectionId ? await svc.classResult(examId, sectionId) : null };
  });
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { options, data, examId, sectionId } = loaded.data;
  const picker = (
    <ResultPicker examId={examId} sectionId={sectionId}
      exams={options.exams.map((e) => ({ value: e.id, label: `${e.name} (${STATUS_LABEL[e.status]})` }))}
      sections={options.sections.map((s) => ({ value: s.id, label: s.label }))} />
  );
  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Results" description="Ranked results for a section, with subject averages." />
        {picker}
        <Panel><WidgetEmptyState title={options.exams.length ? "This exam has no papers yet." : "No exams yet."} description={options.exams.length ? "Add papers to the exam, then enter marks. Ranks appear here." : "Create an exam first, then enter marks."} /><div className="flex justify-center pb-6"><Button asChild className="rounded-full"><a href="/app/exams">Go to exams</a></Button></div></Panel>
      </>
    );
  }

  const { exam, section, summary, results } = data;
  const top = results.find((r) => r.rank === 1);
  const rows = results
    .filter((r) => !q || r.student.name.toLowerCase().includes(q))
    .map((r) => ({
      id: r.student.id, examId: exam.id, rank: r.rank, name: r.student.name, roll: `Roll ${r.student.rollNo ?? "-"} · ${r.student.admissionNo}`,
      totalText: r.maxTotal ? `${marksText(r.total)} / ${marksText(r.maxTotal)}` : null, percentText: r.percent === null ? null : `${r.percent}%`, grade: r.grade, result: r.result,
    }));

  return (
    <>
      <PageHeader eyebrow="Academics" title={`${section.className}-${section.name} · ${exam.name}`}
        description={exam.status === "published" ? "Published: students and parents can see these results." : `${STATUS_LABEL[exam.status]}: students and parents cannot see these yet.`}
        actions={results.length ? (
          <Button asChild variant="secondary" className="rounded-full"><a href={`/app/results/${exam.id}/batch/${section.id}`}>Download all report cards</a></Button>
        ) : null} />
      {picker}
      {exam.status !== "published" ? (
        <Panel className="mb-3"><p className="text-sm text-[var(--ds-on-surface-variant)]">Ranks are worked out from the marks entered so far.{" "}
          <a href={`/app/exams/${exam.id}`} className="text-[var(--ds-on-surface)] underline underline-offset-4">Open the exam to finish marks and publish</a>.</p></Panel>
      ) : null}
      <KpiRow>
        <StatCard label="Passed" value={String(results.filter((r) => r.result === "pass").length)} meta={`of ${summary.count} students`} />
        <StatCard label="Failed" value={String(results.filter((r) => r.result === "fail").length)} meta={results.some((r) => r.result === "pending") ? `${results.filter((r) => r.result === "pending").length} pending` : undefined} />
        <StatCard label="Class average" value={`${summary.averagePercent}%`} />
        <StatCard label="Topper" value={top?.student.name.split(" ")[0] ?? "-"} meta={top?.percent == null ? undefined : `${top.percent}%`} />
      </KpiRow>
      <PanelGrid>
        <div className="lg:col-span-8">
          <DataTable columns={columns} rows={rows} total={rows.length} page={1} pageCount={1} rowHref="/app/results/{examId}/{id}" searchPlaceholder="Search students"
            rowActions={Object.fromEntries(rows.map((r) => [r.id, <a key={r.id} href={`/app/results/${exam.id}/${r.id}/report-card`} aria-label={`Report card for ${r.name}`} className="inline-flex h-8 items-center rounded-full px-3 text-xs text-[var(--ds-on-surface-variant)] hover:bg-white/[0.08] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Report card</a>]))}
            empty={{ title: "No students in this section.", description: "Students show here once they are admitted to it." }} />
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4">
          <Panel title="Pass percent"><SegmentedGauge value={summary.passPercent} tone={summary.passPercent >= 90 ? "success" : summary.passPercent >= 60 ? "info" : "warning"} label="of students passed" /></Panel>
          <Panel title="Subject averages">
            {summary.subjects.length ? (
              <HatchedBars max={100} height={180} items={summary.subjects.map((s) => ({ key: s.paperId, label: s.subject, value: s.averagePercent, display: `${s.averagePercent}%` }))} />
            ) : <WidgetEmptyState title="No papers." description="This class has no papers in the exam." />}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
