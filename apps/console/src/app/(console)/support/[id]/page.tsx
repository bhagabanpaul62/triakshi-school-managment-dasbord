import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { SupportDeskService, supportMayEnter, supportRefusal } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { FileList } from "@smw/ui/comm/FileList";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime, shortDate } from "@smw/ui/format";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@smw/feature-support/inputs";
import { SLA_LABELS, SLA_TONES, ticketRef } from "@smw/feature-support/labels";
import { ReplyForm } from "@/components/reply-form";
import { PRIORITY_TONES, SCHOOL_LABELS, TICKET_LABELS, TICKET_TONES } from "@/lib/tones";
import { addTicketNote, assignTicket, assignTicketToMe, replyToTicket, setTicketCategory, setTicketPriority, setTicketStatus } from "../../actions";

export const metadata = { title: "Ticket" };

const file = (f: { id: string; fileName: string; size: number; contentType: string }) => ({ id: f.id, name: f.fileName, sizeBytes: f.size, type: f.contentType, href: `/api/support/files/${f.id}` });

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  let d;
  try { d = await new SupportDeskService(staff).thread(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { t, schoolName, assignee, messages, files, notes, card, earlier, staff: team, savedReplies, sla } = d;
  const closed = t.status === "closed";
  const mayEnter = supportMayEnter(d);
  const schoolHref = `/schools/${t.schoolId}`;

  return (
    <>
      <EntityHeader back={{ href: "/support", label: "Support" }} title={t.subject}
        chips={<>
          <ToneBadge label={TICKET_LABELS[t.status]!} tone={TICKET_TONES[t.status]} />
          <ToneBadge label={PRIORITY_LABELS[t.priority]} tone={PRIORITY_TONES[t.priority] ?? "default"} />
          {sla !== "none" ? <ToneBadge label={`First reply: ${SLA_LABELS[sla].toLowerCase()}`} tone={SLA_TONES[sla]} /> : null}
        </>}
        meta={[ticketRef(t.number), <Link key="s" href={schoolHref} className="underline underline-offset-4">{schoolName}</Link>, assignee ? `Owner ${assignee}` : "Nobody has taken it", `Opened ${dateTime(t.createdAt)}`, t.replyDueAt && !t.firstReplyAt ? `Reply by ${dateTime(t.replyDueAt)}` : null]}
        actions={<>
          {t.assignedStaffId !== staff.staffId ? <ActionButton action={assignTicketToMe} values={{ id }} label="Take it" variant="default" /> : null}
          <FormModal title="Hand over" icon="users" fields={[{ name: "staffId", label: "Owner", type: "select", required: true, options: [{ value: "none", label: "Nobody (back to the queue)" }, ...team.map((s) => ({ value: s.id, label: s.name }))] }]}
            values={{ staffId: t.assignedStaffId ?? "none" }} hidden={{ id }} action={assignTicket} trigger={{ label: "Assign", variant: "secondary" }} />
          <FormModal title="Type" icon="support" fields={[{ name: "category", label: "Type", type: "select", required: true, options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })) }]}
            values={{ category: t.category }} hidden={{ id }} action={setTicketCategory} trigger={{ label: "Type", variant: "secondary" }} />
          <FormModal title="How urgent" icon="support" fields={[{ name: "priority", label: "How urgent", type: "select", required: true, options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })) }]}
            values={{ priority: t.priority }} hidden={{ id }} action={setTicketPriority} trigger={{ label: "Priority", variant: "secondary" }} summary={t.firstReplyAt ? "Already answered: the reply time stays." : "The reply-by time is worked out again."} />
          {t.status !== "resolved" && !closed ? <ActionButton action={setTicketStatus} values={{ id, status: "resolved" }} label="Mark solved" /> : null}
          {!closed ? <ActionButton action={setTicketStatus} values={{ id, status: "closed" }} label="Close"
            confirm={{ title: "Close this ticket?", body: "The school cannot reply to a closed ticket. They can write a follow-up.", confirmLabel: "Close ticket" }} />
            : <ActionButton action={setTicketStatus} values={{ id, status: "open" }} label="Reopen" />}
        </>} />
      <div className="grid grid-cols-1 gap-6 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {messages.map((m) => {
            const mine = files.filter((f) => f.messageId === m.id);
            return (
              <Panel key={m.id} title={m.fromStaff ? (m.staffName ?? "Triakshi support") : (m.userName ?? "School user")} className={m.fromStaff ? "bg-[var(--ds-surface-container)]" : undefined}
                action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{dateTime(m.createdAt)}</span>}>
                <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{m.body}</p>
                {mine.length ? <FileList className="mt-3" files={mine.map(file)} /> : null}
              </Panel>
            );
          })}
          {closed ? <p className="py-4 text-center text-sm text-[var(--ds-on-surface-muted)]">Closed tickets take no replies. Reopen it to answer.</p>
            : <Panel title="Reply to the school"><ReplyForm ticketId={id} action={replyToTicket} saved={savedReplies} solveBox /></Panel>}
          <Panel title="Internal notes">
            <div className="flex flex-col gap-3">
              {notes.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">No notes yet. Notes are for the team only; the school can never read them.</p> : (
                <ul className="flex flex-col gap-3">{notes.map((n) => (
                  <li key={n.id} className="rounded-2xl bg-white/[0.04] p-3"><p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{n.body}</p><p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{n.staffName ?? "Team"} · {dateTime(n.createdAt)}</p></li>
                ))}</ul>
              )}
              <ReplyForm ticketId={id} action={addTicketNote} files={false} label="Add note" placeholder="A note for the team" />
            </div>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="School">
            <FactList>
              <Fact label="Name"><Link href={schoolHref} className="underline underline-offset-4">{schoolName}</Link></Fact>
              <Fact label="Plan">{d.planName}</Fact>
              <Fact label="Status">{SCHOOL_LABELS[d.schoolStatus] ?? d.schoolStatus}</Fact>
              <Fact label="Setup">{card.setupPercent != null ? `${card.setupPercent}%${card.nextStep ? `, next: ${card.nextStep}` : ""}` : null}</Fact>
              <Fact label="Open tickets">{card.openTickets}</Fact>
              <Fact label="Last sign-in">{card.lastSignIn ? dateTime(card.lastSignIn) : null}</Fact>
            </FactList>
          </Panel>
          <Panel title="Open the school">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">
              {mayEnter ? (d.supportAccess === "until" ? `The school allows it until ${dateTime(d.supportAccessUntil)}.` : "The school allows it. The school is told of every visit.") : supportRefusal(d)}
            </p>
            <Link href={schoolHref} className={`${PILL_BTN} mt-3`}>{mayEnter ? "Open the school" : staff.role === "owner" ? "Emergency entry" : "See the school"}</Link>
          </Panel>
          {t.context.page || t.context.browser || t.context.article ? (
            <Panel title="Caught with it">
              <FactList>
                <Fact label="Page" wrap>{t.context.page}</Fact>
                <Fact label="Browser" wrap>{t.context.browser}</Fact>
                <Fact label="Article read" wrap>{t.context.article}</Fact>
              </FactList>
            </Panel>
          ) : null}
          <Panel title="Type and rating">
            <FactList>
              <Fact label="Type">{CATEGORY_LABELS[t.category]}</Fact>
              <Fact label="Reply by">{t.replyDueAt ? dateTime(t.replyDueAt) : "Set within a minute"}</Fact>
              <Fact label="First reply">{t.firstReplyAt ? dateTime(t.firstReplyAt) : null}</Fact>
              <Fact label="Rating">{t.rating ? `${t.rating} of 5${t.ratingNote ? `: ${t.ratingNote}` : ""}` : null}</Fact>
              <Fact label="Follow-up of">{t.followUpOf ? <Link href={`/support/${t.followUpOf}`} className="underline underline-offset-4">Earlier ticket</Link> : null}</Fact>
            </FactList>
          </Panel>
          <Panel title="Earlier tickets">
            {earlier.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">None from this school.</p> : (
              <ul className="flex flex-col">{earlier.map((e) => (
                <li key={e.id}><Link href={`/support/${e.id}`} className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-1.5 text-sm hover:bg-white/[0.06]"><span className="truncate">{ticketRef(e.number)} {e.subject}</span><span className="text-xs text-[var(--ds-on-surface-muted)]">{TICKET_LABELS[e.status]} · {shortDate(e.createdAt)}</span></Link></li>
              ))}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
