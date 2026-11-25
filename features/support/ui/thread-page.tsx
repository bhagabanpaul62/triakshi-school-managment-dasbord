import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { FileList } from "@smw/ui/comm/FileList";
import { StatusTrack } from "@smw/ui/finance/StatusTrack";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "../inputs";
import { articleBySlug } from "../articles";
import { STAGE_TONES, stageLabel, stageOf, ticketRef, trackFor } from "../labels";
import { SupportService } from "../service";
import { expectedReplyBy, type Priority } from "../sla";
import { closeTicket, rateTicket, reopenTicket, replyToTicket, solveTicket } from "./actions";
import { RatingForm } from "./rating-form";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Support ticket" };

/** /app/support/[id]: where it is, when we aim to reply, the thread with files, and what to do next. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const svc = new SupportService(ctx);
  if (!svc.can("use")) return <NoAccess title="Triakshi support is for your school's staff." hint="Ask your school office. They can write to us for you." />;
  let thread: Awaited<ReturnType<SupportService["thread"]>>;
  try { thread = await svc.thread(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { ticket: t, messages, planKey, followUpOf } = thread;
  const frozen = !!ctx.supportStaffId && ctx.readOnly; // a read-only support session may look, not write
  const ref = ticketRef(t.number);
  const stage = stageOf(t);
  const mine = t.createdByUserId === ctx.userId;
  const by = expectedReplyBy({ createdAt: t.createdAt, priority: t.priority as Priority, replyDueAt: t.replyDueAt }, planKey);
  const late = !t.firstReplyAt && t.status === "open" && by < new Date();
  const hint = t.status === "pending" ? "We replied and are waiting for your answer. Send it below."
    : t.status === "resolved" ? "We marked this solved. If it is not, reopen it. A solved ticket closes by itself after 7 days."
    : t.status === "closed" ? "This ticket is closed."
    : !t.firstReplyAt ? (late ? "This is taking longer than we aimed for. The team has been told." : `We aim to reply by ${dateTime(by)}.`)
    : "We are working on it. You can add to it below.";
  const article = t.context.article ? articleBySlug(t.context.article) : null;
  const facts = [t.context.page ? `Written on ${t.context.page}` : null, t.context.browser].filter(Boolean).join(" · ");

  return (
    <>
      <EntityHeader
        back={{ href: "/app/support", label: "Support" }}
        title={t.subject}
        chips={<><ToneBadge label={stageLabel(t)} tone={STAGE_TONES[stage as 0 | 1 | 2 | 3 | 4]} /><ToneBadge label={CATEGORY_LABELS[t.category]} /></>}
        meta={[ref, `Opened ${dateTime(t.createdAt)}`, PRIORITY_LABELS[t.priority], followUpOf ? <Link key="f" href={`/app/support/${followUpOf.id}`} className="underline underline-offset-4">Follow-up to {ticketRef(followUpOf.number)}</Link> : null]}
        actions={frozen ? null : t.status === "closed" ? <Link href={`/app/support/new?followUp=${t.id}`} className={PILL_BTN}>Write a follow-up</Link>
          : t.status === "resolved" ? <ActionButton action={reopenTicket} values={{ id: t.id }} label="It is not solved: reopen" successMessage="Reopened. The team will look again." />
          : <ActionButton action={solveTicket} values={{ id: t.id }} label="Mark as solved" variant="default" successMessage="Marked as solved" />}
      />
      <div className="h-8" />
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <Panel title="Where it is"><StatusTrack steps={trackFor(t)} label="Ticket progress" />
          <p role="status" className="mt-4 text-sm text-[var(--ds-on-surface-variant)]">{hint}</p>
        </Panel>
        {facts || article ? <p className="px-1 text-xs text-[var(--ds-on-surface-muted)]">{facts}{facts && article ? " · " : ""}{article ? <>Read first: <Link href={`/app/support/help/${article.slug}`} className="underline underline-offset-4">{article.title}</Link></> : null}</p> : null}
        {messages.map((m) => (
          <Panel key={m.id} title={m.author} action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{dateTime(m.createdAt)}</span>} className={m.fromStaff ? "bg-[var(--ds-surface-container)]" : undefined}>
            <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{m.body}</p>
            {m.files.length ? <FileList className="mt-3" files={m.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.contentType, href: f.href }))} /> : null}
          </Panel>
        ))}
        {frozen ? <p role="status" className="rounded-2xl bg-white/[0.05] p-3 text-sm text-[var(--ds-on-surface-variant)]">This is a read-only support session: replying, solving, rating and closing are not available here.</p>
        : t.status === "resolved" || t.status === "closed" ? (
          <Panel title={t.rating ? `You rated this ${t.rating} of 5` : "How did we do?"}>
            <RatingForm ticketId={t.id} action={rateTicket} current={{ rating: t.rating, note: t.ratingNote }} />
          </Panel>
        ) : null}
        {frozen ? null : t.status === "closed" ? (
          <p className="py-4 text-center text-sm text-[var(--ds-on-surface-muted)]">This ticket is closed and takes no more messages. <Link href={`/app/support/new?followUp=${t.id}`} className="text-[var(--ds-color-primary-400)] hover:underline">Write a follow-up</Link> if the problem is back.</p>
        ) : (
          <>
            <Panel title={t.status === "resolved" ? "Still a problem? Reply to reopen" : "Reply"}><ReplyForm ticketId={t.id} action={replyToTicket} /></Panel>
            {mine || ctx.role === "admin" ? (
              <div className="flex justify-end">
                <ActionButton action={closeTicket} values={{ id: t.id }} label="Close this ticket" variant="ghost" successMessage="Ticket closed"
                  confirm={{ title: "Close this ticket?", body: "You will not be able to reply after closing. If the problem comes back you can write a follow-up that links to it.", confirmLabel: "Close ticket" }} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
