import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { LeaveBalanceService } from "../leave-balances";
import { todayIST } from "../stats";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { QueryPicker } from "./QueryPicker";

export const metadata = { title: "Who is away" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** /app/attendance/leave-calendar: the month as one lane per person; a bar is a stretch of approved (solid) or waiting (faint) leave. */
export default async function LeaveCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const asked = (await searchParams).month;
  const month = typeof asked === "string" && MONTH.test(asked) ? asked : todayIST().slice(0, 7);
  const cal = await new LeaveBalanceService(ctx).calendar(month);
  const people = [...new Set(cal.rows.map((r) => r.name))];
  const n = cal.days.length;
  return (
    <>
      <PageHeader eyebrow="Academics" title="Who is away" description={`Staff leave in ${month}. Reasons are not shown here.`}
        actions={<AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/leave-calendar" />} />
      <QueryPicker key={month} fields={[{ name: "month", label: "Month", type: "month", value: month }]} />
      <Panel>
        {people.length === 0 ? <><WidgetEmptyState title="Nobody is away this month." description="Approved and waiting staff leave shows here." />
          <div className="flex justify-center pb-6"><Link href="/app/attendance/leave-requests" className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">Open leave requests</Link></div></> : (
          <div className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <div className="grid items-end gap-px text-[11px] text-[var(--ds-on-surface-muted)]" style={{ gridTemplateColumns: `10rem repeat(${n}, minmax(0, 1fr))` }}>
                <span />{cal.days.map((d) => <span key={d.date} className={`text-center tabular-nums ${d.off ? "opacity-40" : ""}`}>{Number(d.date.slice(8))}</span>)}
              </div>
              {people.map((name) => (
                <div key={name} className="mt-1 grid items-center gap-px rounded-xl py-1 hover:bg-white/[0.03]" style={{ gridTemplateColumns: `10rem repeat(${n}, minmax(0, 1fr))` }}>
                  <span className="truncate pr-2 text-sm text-[var(--ds-on-surface)]">{name}</span>
                  {cal.days.map((d) => {
                    const r = cal.rows.find((x) => x.name === name && x.from <= d.date && d.date <= x.to);
                    return <span key={d.date} title={r ? `${name}, ${r.status === "approved" ? "away" : "leave waiting for a decision"}${r.halfDay ? `, ${r.halfDay} half` : ""}` : undefined}
                      className={`h-5 ${r ? (r.status === "approved" ? "bg-[var(--ds-primary)]" : "bg-[var(--ds-primary)]/30") : d.off ? "bg-white/[0.02]" : "bg-white/[0.05]"} ${r?.halfDay ? "opacity-60" : ""}`} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Solid: approved. Faint: waiting. Grey columns are Sundays and holidays.</p>
      </Panel>
    </>
  );
}
