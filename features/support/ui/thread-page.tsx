import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { dateTime } from "@smw/ui/format";
import { SupportService } from "../service";
import { closeTicket, replyToTicket } from "./actions";
import { PRIORITY_LABELS, TICKET_LABELS, TICKET_TONES } from "./fields";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Support ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const svc = new SupportService(ctx);
  const { ticket, messages } = await svc.thread(id);
  const closed = ticket.status === "closed";
  const hint = ticket.status === "pending" ? "The team replied and is waiting for you. Send your answer below."
    : ticket.status === "resolved" ? "The team marked this resolved. Reply if it is still a problem, or close the ticket."
    : ticket.status === "open" && messages.every((m) => !m.fromStaff) ? "Sent. The team will reply here."
    : null;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/support", label: "Support" }}
        title={ticket.subject}
        chips={<ToneBadge label={TICKET_LABELS[ticket.status]} tone={TICKET_TONES[ticket.status]} />}
        meta={[`Opened ${dateTime(ticket.createdAt)}`, `${PRIORITY_LABELS[ticket.priority]} priority`]}
        actions={!closed && svc.can("use") ? (
          <ActionButton action={closeTicket} values={{ id: ticket.id }} label="Close ticket" successMessage="Ticket closed"
            confirm={{ title: "Close this ticket?", body: "You will not be able to reply after closing. Raise a new ticket if the problem comes back.", confirmLabel: "Close ticket" }} />
        ) : null}
      />
      <div className="h-8" />
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {hint ? <p className="rounded-2xl bg-white/[0.035] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]" role="status">{hint}</p> : null}
        {messages.map((m) => (
          <Panel key={m.id} title={m.author} action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{dateTime(m.createdAt)}</span>} className={m.fromStaff ? "bg-[var(--ds-surface-container)]" : undefined}>
            <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{m.body}</p>
          </Panel>
        ))}
        {closed ? (
          <p className="py-4 text-center text-sm text-[var(--ds-on-surface-muted)]">This ticket is closed. <Link href="/app/support" className="text-[var(--ds-color-primary-400)] hover:underline">Raise a new one</Link> if the problem comes back.</p>
        ) : (
          <Panel title="Reply"><ReplyForm ticketId={ticket.id} action={replyToTicket} /></Panel>
        )}
      </div>
    </>
  );
}
