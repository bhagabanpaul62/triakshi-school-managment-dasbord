import Link from "next/link";
import { ApprovalService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { relative } from "@smw/ui/format";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const staff = await requireStaff();
  const svc = new ApprovalService(staff);
  const [pending, rejected] = await Promise.all([svc.listPending(), svc.listRejected()]);
  const oldest = pending[0];

  return (
    <>
      <PageHeader eyebrow="Platform" title="Approvals"
        description={pending.length
          ? `${pending.length} school${pending.length === 1 ? "" : "s"} waiting. The oldest registered ${relative(oldest!.createdAt)}.`
          : "Every school that registers lands here first. Approving starts its 30-day trial."} />
      <Panel title="Waiting for approval">
        {pending.length === 0 ? <WidgetEmptyState title="Nothing waiting." description="New registrations appear here as soon as they are made. Approved schools move to Schools." /> : (
          <ul className="flex flex-col">
            {pending.map((s) => <QueueRow key={s.id} s={s} />)}
          </ul>
        )}
        {staff.role !== "owner" && pending.length ? <p className="pt-3 text-xs text-[var(--ds-on-surface-muted)]">Only an owner can approve or reject. You can open any school to see its details.</p> : null}
      </Panel>
      {rejected.length ? (
        <div className="pt-6">
          <Panel title="Rejected" action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{rejected.length}</span>}>
            <ul className="flex flex-col">{rejected.map((s) => <QueueRow key={s.id} s={s} />)}</ul>
          </Panel>
        </div>
      ) : null}
    </>
  );
}

function QueueRow({ s }: { s: Awaited<ReturnType<ApprovalService["listPending"]>>[number] }) {
  const where = [s.city, s.state].filter(Boolean).join(", ");
  return (
    <li>
      <Link href={`/approvals/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-2 py-3 transition-colors duration-150 hover:bg-white/[0.04]">
        <span className="min-w-0 flex-1 basis-56">
          <span className="block truncate text-sm">{s.name}</span>
          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{[where, s.board, s.planName ? `${s.planName}, up to ${s.studentCap} students` : null].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="min-w-0 basis-48 text-xs text-[var(--ds-on-surface-muted)]">
          <span className="block truncate text-[var(--ds-on-surface-variant)]">{s.adminName}</span>
          <span className="block truncate">{s.adminEmail}</span>
        </span>
        <ToneBadge label={s.emailVerified ? "Email verified" : "Email not verified"} tone={s.emailVerified ? "success" : "warning"} />
        {s.status === "rejected" ? <ToneBadge label="Rejected" tone="danger" /> : null}
        <span className="w-20 text-right text-xs text-[var(--ds-on-surface-muted)]">{relative(s.createdAt)}</span>
      </Link>
    </li>
  );
}
