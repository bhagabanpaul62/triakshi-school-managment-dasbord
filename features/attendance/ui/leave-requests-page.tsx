import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { LeaveService } from "../leave-service";
import { decideLeave, reverseLeave } from "./actions";
import { reverseFields } from "./fields";
import { AttendanceNav } from "./nav";
import { LeaveList } from "./leave-list";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "Leave requests" };

const rejectFields: Field[] = [{ name: "note", label: "Reason for saying no", type: "textarea", wide: true }];

/** /app/attendance/leave-requests: Pending and Decided requests for the class teacher (own sections) or the admin (everyone). */
export default async function LeaveRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = sp.tab === "decided" ? "decided" : "pending";
  const rows = await new LeaveService(ctx).inbox(tab);

  return (
    <>
      <PageHeader eyebrow="Academics" title="Leave requests" description="Approving marks those school days as leave. Holidays and days already marked present are left alone."
        actions={<AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/leave-requests" />} />
      <nav aria-label="Leave status" className="mb-3 flex w-fit gap-1 rounded-full bg-white/[0.05] p-1">
        {(["pending", "decided"] as const).map((t) => (
          <Link key={t} href={`/app/attendance/leave-requests?tab=${t}`} aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm ${t === tab ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]"}`}>
            {t === "pending" ? "Pending" : "Decided"}
          </Link>
        ))}
      </nav>
      <LeaveList rows={rows}
        empty={tab === "pending" ? { title: "Nothing waiting.", description: "New requests from your students appear here." } : { title: "No decisions yet.", description: "Approved and rejected requests are listed here." }}
        actions={(r) => r.canReverse ? (
          <FormModal title="Reverse this decision" icon="check" fields={reverseFields} action={reverseLeave} hidden={{ id: r.id }} submitLabel="Reverse"
            trigger={{ label: "Reverse", variant: "ghost", size: "sm", plus: false }} />
        ) : r.canDecide ? (
          <>
            <ActionButton action={decideLeave} values={{ id: r.id, decision: "approved" }} label="Approve" variant="default" successMessage="Approved"
              confirm={{ title: "Approve this leave?", body: `${r.who} will be marked on leave for the school days from ${r.fromDate} to ${r.toDate}.`, confirmLabel: "Approve" }} />
            <FormModal title="Reject leave" icon="check" fields={rejectFields} action={decideLeave} hidden={{ id: r.id, decision: "rejected" }} submitLabel="Reject"
              trigger={{ label: "Reject", variant: "ghost", size: "sm", plus: false }} />
          </>
        ) : null} />
    </>
  );
}
