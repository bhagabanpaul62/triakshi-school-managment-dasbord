import { ArrowButton } from "@smw/ui/kit/Panel";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityList, ProgressList, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { shortDate } from "@smw/ui/format";
import type { TeacherHome } from "../home-service";
import { attendanceTone, clock12, plural } from "../rules";
import { PanelRow, Rows, SlotPanel } from "./layout";
import { AnnouncementsBody, TimetableBody, open } from "./parts";

export function TeacherHomeView({ d }: { d: TeacherHome }) {
  const periods = d.today.state === "ok" ? d.today.data : null;
  const teaching = periods?.rows.filter((r) => !r.isBreak) ?? [];
  const next = periods?.rows.find((r) => r.state === "now") ?? periods?.rows.find((r) => r.state === "next");
  const unmarked = d.toMark.state === "ok" ? d.toMark.data.rows.filter((r) => !r.marked) : null;
  const marks = d.marks.state === "ok" ? d.marks.data : null;
  const grading = d.grading.state === "ok" ? d.grading.data : null;

  return (
    <>
      <KpiRow>
        {periods ? <StatCard label="Periods today" value={String(teaching.length)} icon={<MenuIconView name="clock" />} href="/app/timetable"
          meta={periods.day === null ? "No classes on Sunday" : next ? `${next.state === "now" ? "Now" : "Next"}: ${next.subject ?? next.name} at ${clock12(next.startsAt)}` : teaching.length ? "All done for today" : "Nothing scheduled"} /> : null}
        {unmarked ? <StatCard label="Attendance to mark" value={String(unmarked.length)} icon={<MenuIconView name="check" />} href="/app/attendance"
          meta={d.toMark.state === "ok" && d.toMark.data.dayOff ? `No attendance: ${d.toMark.data.dayOff}` : unmarked.length ? plural(unmarked.reduce((n, r) => n + r.students, 0), "student") : "All marked"} /> : null}
        {grading ? <StatCard label="To grade" value={String(grading.toGrade)} icon={<MenuIconView name="assignment" />} href="/app/assignments" meta={grading.toGrade ? "Submissions waiting" : "Nothing waiting"} /> : null}
        {marks ? <StatCard label="Marks to enter" value={String(marks.length)} icon={<MenuIconView name="exam" />} href="/app/exams" meta={marks.length ? "Exam papers with missing marks" : "Nothing pending"} /> : null}
      </KpiRow>
      <Rows>
        <PanelRow cells={[
          { slot: d.today, size: 8, node: <SlotPanel slot={d.today} title="Today's periods" action={open("/app/timetable", "Open timetable")}>{(t) => <TimetableBody t={t} emptyHint="Ask the office to add you to the timetable." />}</SlotPanel> },
          { slot: d.toMark, size: 4, node: (
            <SlotPanel slot={d.toMark} title="Mark attendance" action={open("/app/attendance", "Open attendance")}>
              {(m) => m.dayOff ? <WidgetEmptyState title={`No attendance today.`} description={`${m.dayOff}: nothing to mark.`} />
                : m.rows.length === 0 ? <WidgetEmptyState title="You are not a class teacher." description="Class teachers get their daily register here. Ask the office if that should be you." />
                : (
                  <EntityList
                    maxItems={6}
                    empty={{ title: "", description: "" }}
                    items={m.rows.map((r) => ({
                      id: r.id, title: r.label, subtitle: plural(r.students, "student"),
                      badge: r.marked ? <ToneBadge label="Marked" tone="success" /> : <ArrowButton href={`/app/attendance?sectionId=${r.id}`} label={`Mark ${r.label} now`} />,
                    }))}
                  />
                )}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.grading, size: 4, node: (
            <SlotPanel slot={d.grading} title="Waiting to be graded" action={open("/app/assignments", "Open assignments")}>
              {(g) => (
                <EntityList
                  maxItems={5}
                  empty={{ title: "Nothing to grade.", description: "Submissions show up here as students hand in work." }}
                  items={g.rows.map((r) => ({ id: r.id, title: r.title, subtitle: `${r.sectionLabel} · ${r.subjectName}`, meta: `Due ${shortDate(r.dueAt)}`, href: `/app/assignments/${r.id}`, badge: <ToneBadge label={`${r.toGrade} to grade`} tone="warning" /> }))}
                />
              )}
            </SlotPanel>
          ) },
          { slot: d.marks, size: 4, node: (
            <SlotPanel slot={d.marks} title="Marks to enter" action={open("/app/exams", "Open exams")}>
              {(rows) => (
                <ProgressList
                  maxItems={5}
                  empty={{ title: "No marks pending.", description: "When an exam opens for marks entry, your papers show here." }}
                  items={rows.map((p) => ({ id: p.paperId, label: `${p.subjectName}, ${p.className}`, meta: p.examName, value: `${p.entered}/${p.students}`, progress: p.students ? (p.entered / p.students) * 100 : 0, href: `/app/exams/${p.examId}/marks/${p.paperId}` }))}
                />
              )}
            </SlotPanel>
          ) },
          { slot: d.classMonth, size: 4, node: (
            <SlotPanel slot={d.classMonth} title="My class this month" action={open("/app/attendance/register", "Open register")}>
              {(rows) => rows.length === 0 ? <WidgetEmptyState title="No class of your own." description="Class teachers see their section's attendance here." />
                : <div className="flex flex-col gap-6">{rows.map((r) => r.pct === null
                  ? <WidgetEmptyState key={r.sectionId} title={`${r.label}: no attendance yet`} description="Mark a day and the percentage shows here." />
                  : <SegmentedGauge key={r.sectionId} value={r.pct} tone={attendanceTone(r.pct)} label={`${r.label} attendance`} caption={plural(r.students, "student")} />)}</div>}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.announcements, size: 12, node: <SlotPanel slot={d.announcements} title="Latest announcements" action={open("/app/announcements", "All announcements")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel> },
        ]} />
      </Rows>
    </>
  );
}
