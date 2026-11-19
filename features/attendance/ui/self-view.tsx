import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Panel } from "@smw/ui/kit/Panel";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import type { Ctx } from "@smw/feature-kit";
import { STATUS_LABEL, STATUS_TONE, type AttendanceStatus } from "../constants";
import { StudentAttendanceService } from "../service";
import { addDays, monthDays, schoolYearStart, todayIST } from "../stats";
import { DOT, TEXT, pctTone } from "./tones";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (m: string, n: number) => addDays(`${m}-15`, n * 30).slice(0, 7);
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEGEND: AttendanceStatus[] = ["present", "absent", "late", "leave"];

type Month = Awaited<ReturnType<StudentAttendanceService["studentMonth"]>>;

/** One month as a Monday-first grid: a dot per marked day, holidays and Sundays muted. */
function MonthCalendar({ data, today, basePath }: { data: Month; today: string; basePath: string }) {
  const days = monthDays(data.month);
  const lead = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
  const thisMonth = today.slice(0, 7);
  const c = data.counts;
  return (
    <Panel title={monthName(data.month)} action={
      <span className="flex items-center gap-1">
        <Link href={`${basePath}?month=${shiftMonth(data.month, -1)}`} aria-label="Previous month" title="Previous month" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><IconChevronLeft className="h-4 w-4" aria-hidden /></Link>
        {data.month < thisMonth
          ? <Link href={`${basePath}?month=${shiftMonth(data.month, 1)}`} aria-label="Next month" title="Next month" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><IconChevronRight className="h-4 w-4" aria-hidden /></Link>
          : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] opacity-30" aria-hidden><IconChevronRight className="h-4 w-4" /></span>}
      </span>}>
      <div className="grid grid-cols-7 gap-1 text-center" role="group" aria-label={`Attendance in ${monthName(data.month)}`}>
        {WEEK.map((w) => <span key={w} className="pb-1 font-mono text-[11px] uppercase text-[var(--ds-on-surface-muted)]" aria-hidden>{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden />)}
        {days.map((d) => {
          const s = data.marks[d] as AttendanceStatus | undefined;
          const holiday = data.holidays[d];
          const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
          const label = s ? STATUS_LABEL[s] : holiday ?? (sunday ? "Sunday" : d > today ? "" : "Not marked");
          return (
            <span key={d} role="img" title={label || undefined} aria-label={`${shortDate(d)}${label ? `: ${label}` : ""}`}
              className={`flex aspect-square min-h-10 flex-col items-center justify-center gap-1 rounded-xl text-sm tabular-nums ${d === today ? "bg-white/[0.1]" : "bg-white/[0.03]"} ${s ? (s === "absent" ? TEXT.danger : "text-[var(--ds-on-surface)]") : "text-[var(--ds-on-surface-muted)]"} ${!s && (holiday || sunday || d > today) ? "opacity-40" : ""}`}>
              {Number(d.slice(8))}
              <span className={`h-1.5 w-1.5 rounded-full ${s ? DOT[STATUS_TONE[s]] : "bg-transparent"}`} />
            </span>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-[var(--ds-on-surface-variant)]">
        {c.total === 0 ? "Nothing marked this month." : [c.present && `${c.present} present`, c.absent && `${c.absent} absent`, c.late && `${c.late} late`, c.leave && `${c.leave} on leave`].filter(Boolean).join(" · ")}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ds-on-surface-muted)]" aria-label="Legend">
        {LEGEND.map((s) => <li key={s} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${DOT[STATUS_TONE[s]]}`} />{STATUS_LABEL[s]}</li>)}
        <li className="opacity-70">Faded days are Sundays, holidays or ahead</li>
      </ul>
    </Panel>
  );
}

/** Students see their own attendance; parents see each child's: the year's %, a month calendar, recent absences. */
export async function SelfView({ ctx, month }: { ctx: Ctx; month: string }) {
  const svc = new StudentAttendanceService(ctx);
  const today = todayIST();
  const [from, to] = [schoolYearStart(today), today];
  const kids = await svc.myStudents();
  if (kids.length === 0) return <Panel><WidgetEmptyState title="No student linked to your login." description="Ask the school office to link your account." /></Panel>;

  const data = await Promise.all(kids.map(async (k) => {
    const [summary, recent, cal] = await Promise.all([svc.studentSummary(k.id, from, to), svc.recentAbsences(k.id, 8), svc.studentMonth(k.id, month)]);
    return { kid: k, summary, recent, cal };
  }));
  return (
    <div className="flex flex-col gap-3">
      {data.map(({ kid, summary, recent, cal }) => (
        <PanelGrid key={kid.id}>
          <div className="flex flex-col gap-3 lg:col-span-5">
            <Panel title={kid.name} action={kid.sectionLabel ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{kid.sectionLabel}</span> : undefined}>
              {summary.pct === null
                ? <WidgetEmptyState title="No attendance recorded yet." description="It appears here once the teacher marks a day." />
                : <SegmentedGauge value={summary.pct} tone={pctTone(summary.pct)} label="attendance" caption={`Since ${shortDate(from)}`} />}
              {summary.pct !== null && summary.pct < 75 ? <p className={`mt-3 text-sm ${TEXT.danger}`}>Below the 75% the school expects. Please speak to the class teacher.</p> : null}
              <FactList className="mt-4">
                <Fact label="Present">{String(summary.present)}</Fact>
                <Fact label="Late">{String(summary.late)}</Fact>
                <Fact label="Absent">{String(summary.absent)}</Fact>
                <Fact label="On leave">{String(summary.leave)}</Fact>
              </FactList>
            </Panel>
            <Panel title="Recent absences and late days">
              {recent.length === 0
                ? <WidgetEmptyState title="Nothing to report." description="No absent, late or leave days so far." />
                : (
                  <ul className="flex flex-col">
                    {recent.map((r) => (
                      <li key={r.date} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                        <span className="text-sm text-[var(--ds-on-surface)]">{shortDate(r.date)}</span>
                        <span className="flex min-w-0 items-center gap-3">
                          {r.note ? <span className="truncate text-xs text-[var(--ds-on-surface-muted)]">{r.note}</span> : null}
                          <ToneBadge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </Panel>
          </div>
          <div className="lg:col-span-7"><MonthCalendar data={cal} today={today} basePath="/app/attendance" /></div>
        </PanelGrid>
      ))}
    </div>
  );
}
