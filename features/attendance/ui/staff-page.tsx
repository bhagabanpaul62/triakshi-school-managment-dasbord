import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { StatCard } from "@smw/ui/kit/StatCard";
import { STAFF_STATUSES } from "../constants";
import { StaffAttendanceService } from "../service";
import { isDate, todayIST } from "../stats";
import { markStaffAttendance } from "./actions";
import { AttendanceGrid } from "./AttendanceGrid";
import { AttendanceNav } from "./nav";
import { attendanceNav } from "./pages";
import { QueryPicker } from "./QueryPicker";

export const metadata = { title: "Staff attendance" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ROLE = { teacher: "Teacher", accountant: "Accountant" } as Record<string, string>;

/** /app/attendance/staff: the admin marks teachers and accountants. */
export default async function StaffAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new StaffAttendanceService(ctx);
  const today = todayIST();
  const date = [one((await searchParams).date)].find((d): d is string => !!d && isDate(d) && d <= today) ?? today;
  const [sheet, summary] = await Promise.all([svc.staffSheet(date), svc.todaySummary()]);

  return (
    <>
      <PageHeader eyebrow="People" title="Staff attendance" description="Teachers and accountants, one tap each." actions={<AttendanceNav items={attendanceNav(true, svc.can("manage"))} active="/app/attendance/staff" />} />
      <KpiRow>
        <StatCard label="Present today" value={summary.pct === null ? "-" : `${summary.pct}%`} meta={summary.total ? `${summary.total} staff marked` : "Nothing marked yet"} />
        <StatCard label="Absent" value={String(summary.absent)} meta="Today" />
        <StatCard label="Late" value={String(summary.late)} meta="Today" />
        <StatCard label="Half day or leave" value={String(summary.half_day + summary.leave)} meta="Today" />
      </KpiRow>
      <QueryPicker fields={[{ name: "date", label: "Date", type: "date", value: date, max: today }]} />
      <AttendanceGrid key={date} noun="staff" idKey="userId" statuses={STAFF_STATUSES}
        rows={sheet.rows.map((r) => ({ id: r.userId, name: r.name, meta: ROLE[r.role], status: r.status }))}
        hidden={{ date }} action={markStaffAttendance} canMark={svc.can("manage") && !sheet.holiday}
        notice={sheet.holiday ? `${sheet.holiday} is a holiday. Nothing to mark.` : !svc.can("manage") ? "Only the admin can mark staff." : undefined} />
    </>
  );
}
