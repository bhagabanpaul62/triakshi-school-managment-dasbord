import type { ReactNode } from "react";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { paise } from "@smw/ui/format";
import type { LearnerPanels } from "../home-service";
import { plural } from "../rules";

/** KPI cards both the student and the parent home show, in the order a family checks them. Each drops out with its module. */
export function learnerKpis(p: LearnerPanels, studentId: string | null): ReactNode[] {
  const out: ReactNode[] = [];
  if (p.attendance.state === "ok") {
    const a = p.attendance.data;
    out.push(<StatCard key="att" label="Attendance this month" value={a.pct === null ? "-" : `${Math.round(a.pct)}%`} icon={<MenuIconView name="check" />} href="/app/attendance" meta={a.pct === null ? "Not marked yet" : `${plural(a.absent, "day")} absent`} />);
  }
  if (p.assignments.state === "ok") {
    const a = p.assignments.data, n = a.todo + a.overdue;
    out.push(<StatCard key="asg" label="Assignments due" value={String(n)} icon={<MenuIconView name="assignment" />} href="/app/assignments" meta={a.overdue ? `${a.overdue} overdue` : n ? "None overdue" : "All caught up"} />);
  }
  if (p.results.state === "ok") {
    const r = p.results.data;
    out.push(<StatCard key="res" label="Latest result" value={r?.percent == null ? "-" : `${r.percent}%`} icon={<MenuIconView name="result" />} href={r ? `/app/results/${r.examId}/${r.studentId}` : "/app/results"} meta={r ? [r.examName, r.grade ? `Grade ${r.grade}` : null].filter(Boolean).join(" · ") : "Nothing published yet"} />);
  }
  if (p.fees.state === "ok") {
    const f = p.fees.data;
    out.push(<StatCard key="fee" label="Fees due" value={f ? paise(f.due) : "-"} icon={<MenuIconView name="money" />} href={studentId ? `/app/fees/students/${studentId}` : "/app/fees"} meta={!f ? "Not set up yet" : f.due === 0 ? "Paid up" : f.overdue > 0 ? "Overdue" : "Not overdue"} />);
  }
  return out;
}
