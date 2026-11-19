import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { SupportDeskService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { dateTime } from "@smw/ui/format";
import { ReplyForm } from "@/components/reply-form";
import { PRIORITY_TONES, TICKET_LABELS, TICKET_TONES } from "@/lib/tones";
import { assignTicketToMe, replyToTicket, setTicketPriority, setTicketStatus } from "../../actions";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  let data;
  try { data = await new SupportDeskService(staff).thread(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { t, schoolName, assignee, messages } = data;
  const closed = t.status === "closed";

  return (
    <>
      <EntityHeader back={{ href: "/support", label: "Support" }} title={t.subject}
        chips={<><ToneBadge label={TICKET_LABELS[t.status]!} tone={TICKET_TONES[t.status]} /><ToneBadge label={t.priority[0]!.toUpperCase() + t.priority.slice(1)} tone={PRIORITY_TONES[t.priority] ?? "default"} /></>}
        meta={[schoolName, assignee ? `Owner ${assignee}` : "Nobody has taken it", `Opened ${dateTime(t.createdAt)}`]}
        actions={<>
          {t.assignedStaffId !== staff.staffId ? <ActionButton action={assignTicketToMe} values={{ id }} label="Take it" /> : null}
          <FormModal title="Priority" icon="support" fields={[{ name: "priority", label: "Priority", type: "select", required: true, options: ["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })) }]}
            values={{ priority: t.priority }} hidden={{ id }} action={setTicketPriority} trigger={{ label: "Priority", variant: "secondary" }} />
          {t.status !== "resolved" && !closed ? <ActionButton action={setTicketStatus} values={{ id, status: "resolved" }} label="Mark resolved" /> : null}
          {!closed ? <ActionButton action={setTicketStatus} values={{ id, status: "closed" }} label="Close"
            confirm={{ title: "Close this ticket?", body: "The school cannot reply to a closed ticket.", confirmLabel: "Close ticket" }} />
            : <ActionButton action={setTicketStatus} values={{ id, status: "open" }} label="Reopen" />}
        </>} />
      <div className="mx-auto flex max-w-3xl flex-col gap-3 pt-8">
        {messages.map((m) => (
          <Panel key={m.id} title={m.fromStaff ? (m.staffName ?? "Triakshi support") : (m.userName ?? "School user")} className={m.fromStaff ? "bg-[var(--ds-surface-container)]" : undefined}
            action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{dateTime(m.createdAt)}</span>}>
            <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{m.body}</p>
          </Panel>
        ))}
        {closed ? <p className="py-4 text-center text-sm text-[var(--ds-on-surface-muted)]">Closed tickets take no replies. Reopen it to answer.</p>
          : <Panel title="Reply"><ReplyForm ticketId={id} action={replyToTicket} /></Panel>}
      </div>
    </>
  );
}
