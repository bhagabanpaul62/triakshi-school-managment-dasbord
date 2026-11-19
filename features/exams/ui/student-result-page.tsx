import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { Button } from "@smw/ui/ui/button";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { ProgressList, ToneBadge, type Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { ResultService } from "../service";
import type { SubjectStatus } from "../grading";
import { ErrorPanel, RESULT_LABEL, RESULT_TONE, attempt, marksText } from "./shared";

export const metadata = { title: "Result" };

const SUBJECT: Record<SubjectStatus, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "success" }, fail: { label: "Fail", tone: "danger" }, absent: { label: "Absent", tone: "warning" }, pending: { label: "Pending", tone: "default" },
};

export default async function StudentResultPage({ params }: { params: Promise<{ examId: string; studentId: string }> }) {
  const [{ examId, studentId }, ctx] = await Promise.all([params, requireCtx()]);
  const svc = new ResultService(ctx);
  const loaded = await attempt(() => svc.studentResult(examId, studentId));
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { exam, result: r } = loaded.data;
  const staff = svc.can("read");

  return (
    <>
      <EntityHeader
        back={staff ? { href: `/app/results?examId=${exam.id}&sectionId=${r.student.sectionId}`, label: `${r.student.className}-${r.student.sectionName} results` } : { href: "/app/results", label: "Results" }}
        title={r.student.name}
        chips={<><ToneBadge label={RESULT_LABEL[r.result]} tone={RESULT_TONE[r.result]} />{r.grade ? <ToneBadge label={`Grade ${r.grade}`} /> : null}</>}
        meta={[exam.name, `${r.student.className}-${r.student.sectionName}`, `Admission no ${r.student.admissionNo}`]}
        actions={<Button asChild className="rounded-full"><a href={`/app/results/${exam.id}/${r.student.id}/report-card`} download>Download report card</a></Button>}
        className="pb-8"
      />
      <KpiRow>
        <StatCard label="Percentage" value={r.percent === null ? "-" : `${r.percent}%`} />
        <StatCard label="Total marks" value={marksText(r.total)} meta={`out of ${marksText(r.maxTotal)}`} />
        <StatCard label="Rank in section" value={r.rank ? String(r.rank) : "-"} meta={r.rank ? `of ${r.sectionSize} students` : "Not ranked yet"} />
        <StatCard label="Grade" value={r.grade ?? "-"} meta={r.remark ?? undefined} />
      </KpiRow>
      <PanelGrid>
        <div className="lg:col-span-8">
          <Panel title="Subjects">
            <ProgressList maxItems={30}
              empty={{ title: "No subjects.", description: "This class has no papers in the exam." }}
              items={r.subjects.map((s) => ({
                id: s.id, label: `${s.subject} · ${s.grade ? `${SUBJECT[s.status].label}, grade ${s.grade}` : SUBJECT[s.status].label}`,
                meta: s.status === "absent" ? `Absent · pass at ${s.passMarks}` : `Pass at ${s.passMarks} · ${s.percent ?? 0}%`,
                value: s.status === "absent" ? "AB" : `${marksText(s.marks)} / ${s.maxMarks}`,
                progress: s.status === "absent" ? 0 : s.percent ?? 0,
                tone: s.status === "fail" ? "danger" : s.status === "pass" ? "success" : "warning",
              }))} />
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4">
          <Panel title="Overall"><SegmentedGauge value={r.percent ?? 0} tone={r.result === "fail" ? "danger" : r.result === "pass" ? "success" : "info"} label="overall percentage" /></Panel>
          <Panel title="Details">
            <FactList>
              <Fact label="Exam">{exam.name}</Fact>
              <Fact label="Dates">{shortDate(exam.startsOn)} to {shortDate(exam.endsOn)}</Fact>
              <Fact label="Class">{`${r.student.className}-${r.student.sectionName}`}</Fact>
              <Fact label="Roll no">{r.student.rollNo == null ? null : String(r.student.rollNo)}</Fact>
              <Fact label="Result">{RESULT_LABEL[r.result]}</Fact>
            </FactList>
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
