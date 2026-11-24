import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { fmtDays } from "../leave-days";
import { LeaveTypeService } from "../leave-types";
import { createLeaveType, deleteLeaveType, updateLeaveType } from "./actions";
import { leaveTypeFields } from "./fields";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "Leave types" };

/** /app/attendance/leave-types: the kinds of staff leave, how many days each gives, and which are paid. */
export default async function LeaveTypesPage() {
  const ctx = await requireCtx();
  const svc = new LeaveTypeService(ctx);
  const types = await svc.all({ inactive: true });
  const create = <FormModal title="Add leave type" icon="calendar" fields={leaveTypeFields} values={{ paid: true, halfDayAllowed: true, isActive: true, yearlyDays: 0, carryDays: 0 }} action={createLeaveType} submitLabel="Add" />;
  return (
    <>
      <PageHeader eyebrow="People" title="Leave types" description="Paid types are checked against each person's balance. Unpaid days are cut from salary."
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/leave-types" />{create}</span>} />
      <Panel>
        {types.length === 0 ? <><WidgetEmptyState title="No leave types yet." description="Staff cannot request leave until one exists." /><div className="flex justify-center pb-6">{create}</div></> : (
          <ul className="flex flex-col gap-1">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3 py-3 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface)]">{t.name} <span className="text-xs text-[var(--ds-on-surface-muted)]">{t.code}</span>
                    <ToneBadge label={t.paid ? "Paid" : "Unpaid"} tone={t.paid ? "success" : "warning"} />{t.isActive ? null : <ToneBadge label="Not in use" tone="info" />}</p>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{t.paid ? `${fmtDays(t.yearlyHalfDays)} days a year, carry up to ${fmtDays(t.carryForwardHalfDays)}` : "No limit"}{t.halfDayAllowed ? ", half days" : ""}{t.encashable ? ", paid out on exit" : ""}{t.needsFileAfterDays != null ? `, document after ${t.needsFileAfterDays} days` : ""}</p>
                </div>
                <span className="inline-flex items-center gap-1">
                  <FormModal title="Edit leave type" icon="calendar" fields={leaveTypeFields} values={{ ...t, yearlyDays: t.yearlyHalfDays / 2, carryDays: t.carryForwardHalfDays / 2 }} hidden={{ id: t.id }} action={updateLeaveType} trigger={{ label: "Edit", variant: "ghost", size: "sm", plus: false }} />
                  <ActionButton variant="icon-delete" label="Delete leave type" action={deleteLeaveType} values={{ id: t.id }}
                    confirm={{ title: "Delete this leave type?", body: "A type that has been used cannot be deleted. Untick In use to hide it instead.", confirmLabel: "Delete", danger: true }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
