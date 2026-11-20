import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { timeRange } from "@smw/feature-timetable/bell";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { ATTENDANCE_STATUSES } from "../constants";
import { PeriodAttendanceService, type PeriodItem } from "../period-service";
import { isDate, todayIST } from "../stats";
import { markPeriodAttendance } from "./actions";
import { AttendanceGrid } from "./AttendanceGrid";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { QueryPicker } from "./QueryPicker";

export const metadata = { title: "My classes" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | string[] | undefined) => { const x = one(v); return x && /^[0-9a-f-]{36}$/i.test(x) ? x : undefined; };

/** /app/attendance/periods: a teacher's periods today (own and covers) to mark; the office picks a section and any past day to correct. */
export default async function PeriodsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new PeriodAttendanceService(ctx);
  const sp = await searchParams;
  const nav = attendanceNavFor(ctx);
  const head = (description: string) => <PageHeader eyebrow="Academics" title="My classes" description={description} actions={<AttendanceNav items={nav} active="/app/attendance/periods" />} />;

  if (!svc.can("mark")) return <>{head("Mark the students in each period.")}<Panel><WidgetEmptyState title="You cannot mark attendance." description="Ask the office if you should." /></Panel></>;
  if ((await svc.mode()) !== "period") {
    return <>{head("Mark the students in each period.")}<Panel><WidgetEmptyState title="This school marks attendance once a day." description={svc.can("manage") ? "Turn on period by period in the settings on the Eligibility page." : "Use Mark to take the day's attendance."} /></Panel></>;
  }

  const today = todayIST();
  const isTeacher = ctx.role === "teacher";
  const date = isTeacher ? today : [one(sp.date)].find((d): d is string => !!d && isDate(d) && d <= today) ?? today;
  const sections = isTeacher ? [] : await svc.sectionOptions();
  const sectionId = isTeacher ? undefined : sections.find((s) => s.id === one(sp.sectionId))?.id ?? sections[0]?.id;
  const items = await svc.periods(date, sectionId);

  const base = { date, ...(sectionId ? { sectionId } : {}) };
  const refOf = (i: PeriodItem): Record<string, string> => (i.blockSlotId ? { blockSlotId: i.blockSlotId, optionId: i.optionId! } : { slotId: i.slotId! });
  const href = (i: PeriodItem) => `/app/attendance/periods?${new URLSearchParams({ ...base, ...refOf(i) })}`;
  const asked = { slotId: id(sp.slotId), blockSlotId: id(sp.blockSlotId), optionId: id(sp.optionId) };
  const chosen = items.find((i) => (asked.blockSlotId ? i.blockSlotId === asked.blockSlotId && i.optionId === asked.optionId : !!asked.slotId && i.slotId === asked.slotId));
  const sheet = chosen && chosen.cover !== "away" ? await svc.periodSheet(refOf(chosen), date) : null;

  return (
    <>
      {head(isTeacher ? "The periods you teach or cover today. Tap one to mark it." : "Pick a section and a day to mark or correct a period.")}
      {!isTeacher ? (
        <QueryPicker key={`${sectionId}-${date}`} fields={[
          { name: "sectionId", label: "Section", type: "select", value: sectionId ?? "", options: sections.map((s) => ({ value: s.id, label: s.label })) },
          { name: "date", label: "Date", type: "date", value: date, max: today },
        ]} />
      ) : null}
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
        {shortDate(date)}{date === today ? <ToneBadge label="Today" tone="info" /> : <ToneBadge label="Past day" tone="warning" />}
      </p>
      {items.length === 0 ? (
        <Panel><WidgetEmptyState title={isTeacher ? "No classes today." : "No periods for this section on this day."} description={isTeacher ? "Nothing in the timetable for you today, and no cover to take." : "Check the timetable, or pick another day."} /></Panel>
      ) : (
        <div className="mb-6">
          <Panel title={`${items.length} period${items.length === 1 ? "" : "s"}`}>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              {items.map((i) => {
                const away = i.cover === "away";
                const body = (
                  <>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm text-[var(--ds-on-surface)]">{i.name} · {i.subject ?? "Free"}</span>
                      <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{timeRange(i.startsAt, i.endsAt)}{i.section ? ` · ${i.section}` : ""}{away && i.teacher ? ` · taken by ${i.teacher}` : ""}</span>
                    </span>
                    {i.cover === "covering" ? <ToneBadge label="Cover" tone="info" /> : away ? <ToneBadge label="Covered" /> : null}
                    {!away ? <ToneBadge label={i.marked ? `${i.marked} marked` : "Not marked"} tone={i.marked ? "success" : "warning"} /> : null}
                  </>
                );
                const cls = "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2";
                return (
                  <li key={`${i.periodId}-${i.slotId ?? i.optionId}`}>
                    {away ? <div className={cls}>{body}</div>
                      : <Link href={href(i)} aria-current={i === chosen ? "true" : undefined} className={`${cls} hover:bg-white/[0.05] ${i === chosen ? "bg-white/[0.08]" : ""}`}>{body}</Link>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}
      {sheet && chosen ? (
        <AttendanceGrid key={`${chosen.periodId}-${chosen.optionId ?? chosen.slotId}-${date}`} noun="students" idKey="studentId" statuses={ATTENDANCE_STATUSES}
          rows={sheet.rows.map((r) => ({ id: r.studentId, name: r.name, meta: [r.section, r.rollNo ? `Roll ${r.rollNo}` : null].filter(Boolean).join(" · "), status: r.status }))}
          hidden={{ date, ...refOf(chosen) }} action={markPeriodAttendance} canMark={sheet.canMark}
          notice={sheet.holiday ? `${sheet.holiday} is a holiday, so nobody can be marked.` : !sheet.canMark ? "You can view this period but not change it." : date < today ? `You are correcting ${shortDate(date)}. Changes replace what was saved and update that day's attendance.` : undefined} />
      ) : null}
    </>
  );
}
