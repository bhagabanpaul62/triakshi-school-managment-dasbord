import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { LeaveBalanceService } from "../leave-balances";
import { LeaveService } from "../leave-service";
import { LeaveTypeService } from "../leave-types";
import { applyLeave, cancelLeave, editLeave } from "./actions";
import { ApplyLeave } from "./apply-leave";
import { ApplyStaffLeave } from "./apply-staff-leave";
import { leaveFields } from "./fields";
import { LeaveBars } from "./leave-bars";
import { LeaveList } from "./leave-list";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "My leave" };

/** /app/attendance/my-leave: apply for leave and follow your requests. Students and staff both come here. */
export default async function MyLeavePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const isStudent = ctx.role === "student";
  const svc = new LeaveService(ctx);
  const created = (await searchParams).new;
  const [rows, kids, types, balances] = await Promise.all([
    svc.mine(), svc.applicants(), isStudent ? [] : new LeaveTypeService(ctx).all(), isStudent ? [] : new LeaveBalanceService(ctx).mine(),
  ]);
  const admin = new LeaveTypeService(ctx).can("manage");
  const typeOptions = types.map((t) => ({ id: t.id, name: t.name, halfDayAllowed: t.halfDayAllowed }));
  const noTypes = !isStudent && types.length === 0;
  const apply = isStudent ? <ApplyLeave kids={kids} /> : noTypes ? null : <ApplyStaffLeave types={typeOptions} />;

  return (
    <>
      <PageHeader eyebrow="Academics" title="My leave" description={isStudent ? "Ask the class teacher for leave. Approved days show as leave in the attendance record." : "Ask the admin for leave. Approved days show as leave in your attendance."}
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/my-leave" />{apply}</span>} />
      {noTypes ? (
        <Panel><p className="text-sm text-[var(--ds-on-surface)]">No leave types are set up yet, so leave cannot be requested.</p>
          <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{admin ? <>Add them first: <Link href="/app/attendance/leave-types" className="text-[var(--ds-primary)] underline">Leave types</Link>.</> : "Ask the school admin to set up leave types."}</p></Panel>
      ) : balances.length ? <div className="mb-4"><LeaveBars rows={balances} /></div> : null}
      <LeaveList rows={rows} highlight={typeof created === "string" ? created : undefined}
        empty={{ title: "No leave requests yet.", description: "Use Apply for leave when you need days off.", action: apply ?? undefined }}
        actions={(r) => r.canEdit ? (
          <>
            <FormModal title="Edit leave request" icon="calendar" fields={leaveFields({ types: isStudent ? undefined : typeOptions })} values={r} hidden={{ id: r.id }} action={editLeave} trigger={{ label: "Edit", variant: "ghost", size: "sm", plus: false }} />
            <ActionButton action={cancelLeave} values={{ id: r.id }} label="Withdraw" variant="ghost" successMessage="Request withdrawn"
              confirm={{ title: "Withdraw this request?", body: "Nobody will decide on it.", confirmLabel: "Withdraw" }} />
          </>
        ) : r.status === "rejected" ? (
          isStudent
            ? <FormModal title="Edit and resend" icon="calendar" fields={leaveFields({ kids, file: true })} values={r} action={applyLeave} submitLabel="Send request" trigger={{ label: "Edit and resend", variant: "ghost", size: "sm", plus: false }} />
            : <ApplyStaffLeave types={typeOptions} label="Edit and resend" variant="ghost" initial={{ typeId: r.typeId ?? undefined, fromDate: r.fromDate, toDate: r.toDate, halfDay: r.halfDay, reason: r.reason }}
                notice={r.note ? <p className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">Why it was not approved: {r.note}</p> : undefined} />
        ) : null} />
    </>
  );
}
