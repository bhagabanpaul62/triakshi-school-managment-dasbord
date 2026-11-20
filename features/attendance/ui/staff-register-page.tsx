import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { STATUS_LABEL, STATUS_LETTER } from "../constants";
import { StaffAttendanceService } from "../service";
import { todayIST } from "../stats";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { QueryPicker } from "./QueryPicker";
import { statusText } from "./tones";
import type { AttendanceStatus } from "../constants";

export const metadata = { title: "Staff register" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** /app/attendance/staff/register: the month of staff attendance, with PDF and CSV. */
export default async function StaffRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const asked = (await searchParams).month;
  const month = typeof asked === "string" && MONTH.test(asked) ? asked : todayIST().slice(0, 7);
  const reg = await new StaffAttendanceService(ctx).monthlyRegister(month);
  const link = (format: string) => `/app/attendance/register/export?month=${month}&format=${format}`;

  return (
    <>
      <PageHeader eyebrow="People" title="Staff register" description={`Teachers and accountants, ${month}`}
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/staff/register" />
          <a href={link("pdf")} className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">Download PDF</a>
          <a href={link("csv")} className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">Download CSV</a></span>} />
      <QueryPicker key={month} fields={[{ name: "month", label: "Month", type: "month", value: month }]} />
      <Panel>
        {reg.people.length === 0 ? <WidgetEmptyState title="No staff yet." description="Add teachers or accountants first." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Staff attendance register, {month}</caption>
              <thead>
                <tr className="text-[11px] text-[var(--ds-on-surface-muted)]">
                  <th scope="col" className="sticky left-0 bg-[var(--ds-surface-container-low)] py-2 pr-4 text-left font-normal">Staff</th>
                  {reg.days.map((d) => <th key={d.date} scope="col" title={d.holiday ?? undefined} className={`w-7 px-0.5 py-2 text-center font-normal tabular-nums ${d.sunday || d.holiday ? "opacity-40" : ""}`}>{d.day}</th>)}
                </tr>
              </thead>
              <tbody>
                {reg.people.map((p) => (
                  <tr key={p.name + p.sub} className="hover:bg-white/[0.03]">
                    <th scope="row" className="sticky left-0 max-w-[14rem] truncate bg-[var(--ds-surface-container-low)] py-1.5 pr-4 text-left font-normal text-[var(--ds-on-surface)]">{p.name} <span className="text-xs text-[var(--ds-on-surface-muted)]">{p.sub}</span></th>
                    {reg.days.map((d) => {
                      const s = p.marks[d.date] as AttendanceStatus | undefined;
                      return <td key={d.date} title={s ? STATUS_LABEL[s] : undefined} className={`px-0.5 py-1.5 text-center text-xs ${s ? statusText(s) : "text-[var(--ds-on-surface-muted)] opacity-40"}`}>{s ? STATUS_LETTER[s] : "·"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">P present · A absent · L late · V on leave · H half day. The PDF has the totals and %.</p>
      </Panel>
    </>
  );
}
