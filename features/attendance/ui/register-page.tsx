import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { DEFAULTER_BELOW, STATUS_LABEL, STATUS_LETTER } from "../constants";
import { PeriodAttendanceService } from "../period-service";
import { attendancePercent, monthDays, todayIST } from "../stats";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { QueryPicker } from "./QueryPicker";
import { TEXT, statusText } from "./tones";

export const metadata = { title: "Attendance register" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** /app/attendance/register: a section's month as a matrix with % per student, plus the school's defaulters. */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new PeriodAttendanceService(ctx);
  const sp = await searchParams;
  const sections = await svc.sectionOptions();
  const sectionId = sections.find((s) => s.id === one(sp.sectionId))?.id ?? sections[0]?.id;
  const month = [one(sp.month)].find((m): m is string => !!m && MONTH.test(m)) ?? todayIST().slice(0, 7);
  const nav = attendanceNavFor(ctx);
  const subjectView = one(sp.view) === "subject";
  const days = monthDays(month);

  const [register, defaulters, bySubject] = await Promise.all([
    sectionId ? svc.monthlyRegister(sectionId, month) : null, svc.defaulters(),
    sectionId && subjectView ? svc.subjectReport(sectionId, days[0]!, days.at(-1)!) : null,
  ]);

  const rows = register?.rows ?? [];
  const classPct = attendancePercent(rows.reduce((a, r) => ({ present: a.present + r.counts.present, late: a.late + r.counts.late, absent: a.absent + r.counts.absent, half_day: a.half_day + r.counts.half_day }), { present: 0, late: 0, absent: 0, half_day: 0 }));
  const low = rows.filter((r) => r.pct !== null && r.pct < DEFAULTER_BELOW).length;
  const daysMarked = register ? register.days.filter((d) => rows.some((r) => r.marks[d.date])).length : 0;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Attendance register" description={register ? `${register.section.label}, ${monthName(month)}` : undefined} actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={nav} active="/app/attendance/register" />
          {sectionId ? <>
            {subjectView ? null : <a href={`/app/attendance/register/export?sectionId=${sectionId}&month=${month}&format=pdf`} className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">Print PDF</a>}
            <a href={`/app/attendance/register/export?sectionId=${sectionId}&month=${month}&format=csv${subjectView ? "&view=subject" : ""}`} className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">CSV</a></> : null}</span>} />
      {!sectionId || !register ? (
        <Panel><WidgetEmptyState title="No sections to show." description="Set up classes and sections first." /></Panel>
      ) : (
        <>
        <QueryPicker key={`${sectionId}-${month}`} fields={[
          { name: "sectionId", label: "Section", type: "select", value: sectionId, options: sections.map((s) => ({ value: s.id, label: s.label })) },
          { name: "month", label: "Month", type: "month", value: month },
        ]} />
        <nav aria-label="Register view" className="mb-3 flex w-fit gap-1 rounded-full bg-white/[0.05] p-1">
          {([["daily", "By day"], ["subject", "By subject"]] as const).map(([v, label]) => (
            <Link key={v} href={`/app/attendance/register?sectionId=${sectionId}&month=${month}${v === "subject" ? "&view=subject" : ""}`} aria-current={(v === "subject") === subjectView ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm ${(v === "subject") === subjectView ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]"}`}>{label}</Link>
          ))}
        </nav>
        <KpiRow>
          <StatCard label="Class attendance" value={classPct === null ? "-" : `${classPct}%`} meta={monthName(month)} />
          <StatCard label={`Below ${DEFAULTER_BELOW}%`} value={String(low)} meta={`of ${rows.length} students`} />
          <StatCard label="Days marked" value={String(daysMarked)} meta={`of ${register.days.length} in the month`} />
          <StatCard label="Defaulters, school" value={String(defaulters.length)} meta="Last 90 days" />
        </KpiRow>
        <PanelGrid>
          <div className="lg:col-span-9">
            <Panel>
              {register.rows.length === 0 ? <WidgetEmptyState title="No students in this section." description="Admit students to see their register." /> : bySubject ? (
                bySubject.subjects.length === 0 ? <WidgetEmptyState title="No period marks this month." description="Subject-wise percentages come from period-by-period attendance. Turn it on in the Eligibility settings." /> : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
                        <caption className="sr-only">Subject-wise attendance for {register.section.label}, {monthName(month)}</caption>
                        <thead>
                          <tr className="text-[11px] text-[var(--ds-on-surface-muted)]">
                            <th scope="col" className="sticky left-0 bg-[var(--ds-surface-container-low)] py-2 pr-4 text-left font-normal">Student</th>
                            {bySubject.subjects.map((s) => <th key={s.id} scope="col" className="px-3 py-2 text-right font-normal">{s.name}</th>)}
                            <th scope="col" className="py-2 pl-3 text-right font-normal">Overall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bySubject.rows.map((r) => (
                            <tr key={r.studentId} className="hover:bg-white/[0.03]">
                              <th scope="row" className="sticky left-0 max-w-[14rem] truncate bg-[var(--ds-surface-container-low)] py-1.5 pr-4 text-left font-normal text-[var(--ds-on-surface)]">{r.name}</th>
                              {bySubject.subjects.map((s) => {
                                const c = r.bySubject[s.id];
                                return <td key={s.id} title={c ? `${c.attended} of ${c.total} periods` : undefined} className={`px-3 py-1.5 text-right tabular-nums ${c?.pct != null && c.pct < DEFAULTER_BELOW ? TEXT.danger : "text-[var(--ds-on-surface)]"}`}>{c?.pct == null ? "-" : `${c.pct}%`}</td>;
                              })}
                              <td className={`py-1.5 pl-3 text-right tabular-nums ${r.overall !== null && r.overall < DEFAULTER_BELOW ? TEXT.danger : "text-[var(--ds-on-surface)]"}`}>{r.overall === null ? "-" : `${r.overall}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Periods attended over periods held, per subject. Late counts as attended; leave is left out. Hover a cell for the count.</p>
                  </>
                )
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
                      <caption className="sr-only">Attendance register for {register.section.label}, {monthName(month)}</caption>
                      <thead>
                        <tr className="text-[11px] text-[var(--ds-on-surface-muted)]">
                          <th scope="col" className="sticky left-0 bg-[var(--ds-surface-container-low)] py-2 pr-4 text-left font-normal">Student</th>
                          {register.days.map((d) => (
                            <th key={d.date} scope="col" title={d.holiday ?? undefined} className={`w-7 px-0.5 py-2 text-center font-normal tabular-nums ${d.sunday || d.holiday ? "opacity-40" : ""}`}>{d.day}</th>
                          ))}
                          <th scope="col" className="px-3 py-2 text-right font-normal">Absent</th>
                          <th scope="col" className="py-2 pl-3 text-right font-normal">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {register.rows.map((r) => (
                          <tr key={r.studentId} className="hover:bg-white/[0.03]">
                            <th scope="row" className="sticky left-0 max-w-[14rem] truncate bg-[var(--ds-surface-container-low)] py-1.5 pr-4 text-left font-normal text-[var(--ds-on-surface)]">{r.name}</th>
                            {register.days.map((d) => {
                              const s = r.marks[d.date];
                              return (
                                <td key={d.date} title={s ? STATUS_LABEL[s] : undefined} className={`px-0.5 py-1.5 text-center text-xs ${s ? statusText(s) : "text-[var(--ds-on-surface-muted)] opacity-40"}`}>
                                  {s ? STATUS_LETTER[s] : "·"}
                                </td>
                              );
                            })}
                            <td className="px-3 py-1.5 text-right tabular-nums">{r.counts.absent}</td>
                            <td className={`py-1.5 pl-3 text-right tabular-nums ${r.pct !== null && r.pct < DEFAULTER_BELOW ? TEXT.danger : "text-[var(--ds-on-surface)]"}`}>{r.pct === null ? "-" : `${r.pct}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">P present · A absent · L late · V on leave. Print PDF gives the A4 landscape register. Leave days are excused and left out of the %.</p>
                </>
              )}
            </Panel>
          </div>
          <div className="lg:col-span-3">
            <Panel title={`Below ${DEFAULTER_BELOW}%, last 90 days`}>
              {defaulters.length === 0 ? <WidgetEmptyState title="No defaulters." description="Everyone is at or above the mark over the last 90 days." /> : (
                <ul className="flex flex-col">
                  {defaulters.slice(0, 12).map((d) => (
                    <li key={d.studentId}>
                      <Link href={d.sectionId ? `/app/attendance/register?sectionId=${d.sectionId}&month=${month}` : "#"} className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[var(--ds-on-surface)]">{d.name}</span>
                          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{d.sectionLabel ?? "No section"} · {d.absent} absent of {d.counted} days</span>
                        </span>
                        <span className={`text-sm tabular-nums ${TEXT.danger}`}>{d.pct}%</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </PanelGrid>
        </>
      )}
    </>
  );
}
