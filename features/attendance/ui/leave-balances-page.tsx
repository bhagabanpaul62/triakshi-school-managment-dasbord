import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { LeaveBalanceService } from "../leave-balances";
import { fmtDays } from "../leave-days";
import { shortDate } from "@smw/ui/format";
import { adjustLeave } from "./actions";
import { adjustFields } from "./fields";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "Leave balances" };

/** /app/attendance/leave-balances: every staff member against every leave type for this leave year, with adjust and CSV. */
export default async function LeaveBalancesPage() {
  const ctx = await requireCtx();
  const t = await new LeaveBalanceService(ctx).table();
  const adjust = <FormModal title="Adjust a balance" icon="calendar" fields={adjustFields(t.people, t.types)} action={adjustLeave} submitLabel="Save" trigger={{ label: "Adjust", variant: "secondary", plus: false }} />;
  return (
    <>
      <PageHeader eyebrow="People" title="Leave balances" description={`Leave year ${shortDate(t.start)} to ${shortDate(t.end)}. Days left, after waiting requests.`}
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/leave-balances" />
          {t.people.length ? adjust : null}
          <a href="/app/attendance/leave-balances/export" className="rounded-full bg-white/[0.08] px-4 py-2 text-sm hover:bg-white/[0.12]">Download CSV</a></span>} />
      <Panel>
        {t.people.length === 0 ? <WidgetEmptyState title="No staff yet." description="Add staff first; their balances appear here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Leave balances by person and type</caption>
              <thead><tr className="text-xs text-[var(--ds-on-surface-muted)]">
                <th scope="col" className="sticky left-0 bg-[var(--ds-surface-container-low)] py-2 pr-4 text-left font-normal">Staff</th>
                {t.types.map((x) => <th key={x.id} scope="col" className="px-3 py-2 text-right font-normal">{x.name}</th>)}
              </tr></thead>
              <tbody>
                {t.people.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.03]">
                    <th scope="row" className="sticky left-0 max-w-[14rem] truncate bg-[var(--ds-surface-container-low)] py-2 pr-4 text-left font-normal text-[var(--ds-on-surface)]">{p.name}</th>
                    {p.balances.map((b) => (
                      <td key={b.typeId} className="px-3 py-2 text-right tabular-nums text-[var(--ds-on-surface)]" title={`${fmtDays(b.entitled)} credited, ${fmtDays(b.used)} used, ${fmtDays(b.pending)} waiting`}>
                        {b.paid ? fmtDays(b.left) : fmtDays(b.used)}{b.pending ? <span className="text-xs text-[var(--ds-on-surface-muted)]"> ({fmtDays(b.pending)})</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Paid types show days left; unpaid types show days taken. In brackets: days waiting for a decision.</p>
      </Panel>
    </>
  );
}
