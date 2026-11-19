import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { Panel, ArrowButton } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { TrendArea } from "@smw/ui/kit/TrendArea";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { ATTENDANCE_STATUSES } from "../constants";
import { StaffAttendanceService, StudentAttendanceService } from "../service";
import { addDays, isDate, isSunday, todayIST } from "../stats";
import { markStudentAttendance } from "./actions";
import { AttendanceGrid } from "./AttendanceGrid";
import { AttendanceNav } from "./nav";
import { QueryPicker } from "./QueryPicker";
import { SelfView } from "./self-view";
import { attendanceNav } from "./pages";

export const metadata = { title: "Attendance" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pctText = (p: number | null) => (p === null ? "-" : `${p}%`);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/** /app/attendance: staff mark a section for a day; students and parents see their own record. */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new StudentAttendanceService(ctx);
  const sp = await searchParams;

  if (svc.can("self")) {
    const month = [one(sp.month)].find((m): m is string => !!m && MONTH.test(m) && m <= todayIST().slice(0, 7));
    return (
      <>
        <PageHeader eyebrow="Academics" title="Attendance" description="Your attendance this school year." />
        <SelfView ctx={ctx} month={month ?? todayIST().slice(0, 7)} />
      </>
    );
  }

  const today = todayIST();
  const isTeacher = ctx.role === "teacher";
  const asked = one(sp.date);
  const date = asked && isDate(asked) && asked <= today ? asked : today;
  const clamped = !!asked && isDate(asked) && asked > today;
  const sections = await svc.sectionOptions();
  const progress = isTeacher ? [] : await svc.sectionProgress(date);
  // Default: a teacher's own class; for the office, the first section that is still unmarked.
  const fallback = sections.find((s) => s.own)?.id ?? progress.find((p) => p.marked < p.students)?.id ?? sections[0]?.id;
  const sectionId = sections.find((s) => s.id === one(sp.sectionId))?.id ?? fallback;
  const nav = attendanceNav(svc.can("read"), new StaffAttendanceService(ctx).can("manage"));
  const pending = progress.filter((p) => p.marked < p.students);

  const [summary, trend, sheet] = await Promise.all([
    isTeacher ? null : svc.todaySchoolSummary(),
    isTeacher ? [] : svc.trend(30),
    sectionId ? svc.sectionSheet(sectionId, date) : null,
  ]);

  const dayNote = sheet?.holiday ? undefined
    : date < today ? `You are editing ${shortDate(date)}, a past day. Changes replace what was saved.`
    : isSunday(date) ? `${shortDate(date)} is a Sunday. Mark only if the school is open.` : undefined;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Attendance" description={isTeacher ? "Mark your class in one tap, then save." : "Who has been marked, and who still needs chasing."} actions={<AttendanceNav items={nav} active="/app/attendance" />} />
      {summary ? (
        <KpiRow>
          <StatCard label="Present today" value={pctText(summary.pct)} meta={summary.marked ? `${summary.marked} of ${summary.students} students marked` : "Nothing marked yet"} />
          <StatCard label="Absent" value={String(summary.absent)} meta="Today" />
          <StatCard label="Late" value={String(summary.late)} meta="Today" />
          <StatCard label="On leave" value={String(summary.leave)} meta="Today" />
        </KpiRow>
      ) : null}

      {!isTeacher && progress.length > 0 ? (
        <div className="mb-8">
          <Panel title={pending.length ? `${pending.length} of ${progress.length} sections not marked${date === today ? " today" : ` on ${shortDate(date)}`}` : `All ${progress.length} sections marked${date === today ? " today" : ` on ${shortDate(date)}`}`}>
            {pending.length === 0
              ? <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing to chase. Open any section below to review or change it.</p>
              : (
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
                  {pending.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/[0.04]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--ds-on-surface)]">{p.label}</span>
                        <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{p.teacher ? `Class teacher ${p.teacher}` : "No class teacher set"}</span>
                      </span>
                      <span className="w-24 shrink-0"><TickBar value={(p.marked / p.students) * 100} tone={p.marked === 0 ? "danger" : "warning"} /></span>
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{p.marked}/{p.students}</span>
                      <ArrowButton href={`/app/attendance?sectionId=${p.id}&date=${date}`} label={`Open ${p.label}`} />
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        </div>
      ) : null}

      {!sectionId || !sheet ? (
        <Panel><WidgetEmptyState title="No sections to mark." description={isTeacher ? "You are not assigned to any section yet. Ask the office to make you a class teacher." : "Set up classes and sections first."} /></Panel>
      ) : (
        <>
          <QueryPicker key={`${sectionId}-${date}`} fields={[
            { name: "sectionId", label: "Section", type: "select", value: sectionId, options: sections.map((s) => ({ value: s.id, label: s.own ? `${s.label} (your class)` : s.label })) },
            { name: "date", label: "Date", type: "date", value: date, max: today },
          ]} />
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
            {dayName(date)}
            {date === today ? <ToneBadge label="Today" tone="info" /> : date === addDays(today, -1) ? <ToneBadge label="Yesterday" /> : <ToneBadge label="Past day" tone="warning" />}
            {clamped ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Future days cannot be marked, so we opened today.</span> : null}
          </p>
          <AttendanceGrid key={`${sectionId}-${date}`} noun="students" idKey="studentId" statuses={ATTENDANCE_STATUSES}
            rows={sheet.rows.map((r) => ({ id: r.studentId, name: r.name, meta: r.rollNo ? `Roll ${r.rollNo}` : r.admissionNo, status: r.status }))}
            hidden={{ sectionId, date }} action={markStudentAttendance}
            canMark={svc.can("mark") && !sheet.holiday}
            notice={sheet.holiday ? `${sheet.holiday} is a holiday, so nobody can be marked.` : !svc.can("mark") ? "You can view this sheet but not change it." : dayNote} />
        </>
      )}

      {!isTeacher ? (
        <div className="mt-3">
          <PanelGrid>
            <div className="lg:col-span-12">
              <Panel title="Attendance, last 30 days">
                {trend.length < 2
                  ? <WidgetEmptyState title="Not enough days yet." description="The trend appears after two marked days." />
                  : <TrendArea data={trend.map((p) => ({ label: shortDate(p.date), pct: p.pct }))} xKey="label" series={[{ key: "pct", label: "Present %", accent: true }]} format={(v) => `${v}%`} />}
              </Panel>
            </div>
          </PanelGrid>
        </div>
      ) : null}
    </>
  );
}
