import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { LeaveService } from "../leave-service";
import { FormModal } from "@smw/ui/shell/FormModal";
import { cancelLeave, editLeave } from "./actions";
import { leaveFields } from "./fields";
import { AttendanceNav } from "./nav";
import { ApplyLeave } from "./apply-leave";
import { LeaveList } from "./leave-list";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "My leave" };

/** /app/attendance/my-leave: apply for leave and follow your requests. Students and staff both come here. */
export default async function MyLeavePage() {
  const ctx = await requireCtx();
  const svc = new LeaveService(ctx);
  const [rows, kids] = await Promise.all([svc.mine(), svc.applicants()]);
  return (
    <>
      <PageHeader eyebrow="Academics" title="My leave" description={ctx.role === "student" ? "Ask the class teacher for leave. Approved days show as leave in the attendance record." : "Ask the admin for leave. Approved days show as leave in your attendance."}
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/my-leave" /><ApplyLeave kids={kids} /></span>} />
      <LeaveList rows={rows} empty={{ title: "No leave requests yet.", description: "Use Apply for leave when you need days off." }}
        actions={(r) => r.canEdit ? (
          <>
            <FormModal title="Edit leave request" icon="calendar" fields={leaveFields()} values={r} hidden={{ id: r.id }} action={editLeave} trigger={{ label: "Edit", variant: "ghost", size: "sm", plus: false }} />
            <ActionButton action={cancelLeave} values={{ id: r.id }} label="Withdraw" variant="ghost" successMessage="Request withdrawn"
            confirm={{ title: "Withdraw this request?", body: "Nobody will decide on it.", confirmLabel: "Withdraw" }} />
          </>
        ) : null} />
    </>
  );
}
