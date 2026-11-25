import Link from "next/link";
import { IconBook2, IconSearch } from "@tabler/icons-react";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/tone";
import { PRIMARY_BTN, PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { SupportService } from "../service";
import { activeNotices } from "../notices";
import { PRIORITY_LABELS } from "../inputs";
import { STAGES, stageLabel, ticketRef } from "../labels";

export const metadata = { title: "Support" };

const TONES = { Sent: "info", "We are on it": "info", "Waiting for you": "warning", Solved: "success", Closed: "default" } as const;
const columns: Column[] = [
  { key: "ref", label: "Ticket", type: "mono", width: "6rem" },
  { key: "subject", label: "Subject" },
  { key: "stage", label: "Where it is", type: "badge", tones: TONES },
  { key: "priority", label: "How urgent", labels: PRIORITY_LABELS, hideOnMobile: true },
  { key: "lastMessageAt", label: "Last message", type: "date" },
];

/** /app/support: help search on top, my tickets (all of the school's with support:all), and what Triakshi is telling schools. */
export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SupportService(ctx);
  if (!svc.can("use")) return <NoAccess title="Triakshi support is for your school's staff." hint="Ask your school office. They can write to us for you." />;
  const sp = await searchParams;
  const [page, waiting, notices] = await Promise.all([svc.list(listQueryFrom(sp)), svc.waiting(), activeNotices(ctx.schoolId, 5).catch(() => [])]);
  const rows = page.rows.map((t) => ({ ...t, ref: ticketRef(t.number), stage: stageLabel(t) }));
  const frozen = !!ctx.supportStaffId && ctx.readOnly; // a read-only support session may look, not write
  const newTicket = frozen ? null : <Link href="/app/support/new" className={PRIMARY_BTN}>New ticket</Link>;
  // The header holds the one filled button; the empty state offers the same step as a quiet one.
  const firstTicket = frozen ? null : <Link href="/app/support/new" className={PILL_BTN}>Write the first ticket</Link>;

  return (
    <>
      <PageHeader eyebrow="School" title="Support"
        description={waiting ? `${waiting} ${waiting === 1 ? "ticket is" : "tickets are"} waiting for your reply.` : "Find an answer, or ask the Triakshi team. Replies show up here."}
        actions={<><Link href="/app/support/help" className={PILL_BTN}><IconBook2 className="h-4 w-4" aria-hidden />Help articles</Link>{newTicket}</>} />

      {frozen ? <p role="status" className="mb-4 rounded-2xl bg-white/[0.05] p-3 text-sm text-[var(--ds-on-surface-variant)]">You are in a read-only support session. You can read tickets, not send or change them.</p> : null}
      <form action="/app/support/help" method="get" role="search" className="relative mb-6">
        <label htmlFor="help-q" className="sr-only">Search the help articles</label>
        <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <input id="help-q" name="q" type="search" placeholder="Search help, e.g. take a fee" className={`${INPUT} pl-11`} autoComplete="off" />
      </form>

      <div className="mb-6">
        {notices.length === 0 ? (
          <p role="status" className="flex min-h-12 items-center gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] px-5 py-3 text-sm"><span className="font-medium">Status</span><span className="text-[var(--ds-on-surface-muted)]">Everything is running normally. Nothing planned.</span></p>
        ) : (
        <Panel title="Status">
          {(
            <ul className="flex flex-col gap-3">
              {notices.map((n) => (
                <li key={n.id}>
                  <p className="text-sm font-medium text-[var(--ds-on-surface)]">{n.title}</p>
                  <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{n.body}</p>
                  <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">From {dateTime(n.startsAt)}{n.endsAt ? ` until ${dateTime(n.endsAt)}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        rowHref="/app/support/{id}"
        searchPlaceholder="Search by subject or number (T-1042)"
        filters={[
          { key: "status", label: "Where it is", options: [{ value: "open", label: "Sent or being worked on" }, { value: "pending", label: STAGES[2] }, { value: "resolved", label: STAGES[3] }, { value: "closed", label: STAGES[4] }] },
          ...(svc.can("all") ? [{ key: "scope", label: "Whose", options: [{ value: "mine", label: "Only mine" }] }] : []),
        ]}
        empty={{ title: svc.can("all") ? "No tickets from your school yet." : "You have not sent a ticket yet.", description: "Something not working or unclear? Search the help articles first, then write to us.", action: firstTicket }}
      />
      {rows.length === 0 && page.total === 0 ? null : <p className="pt-4 text-xs text-[var(--ds-on-surface-muted)]">{svc.can("all") ? "You see every ticket from your school." : "You see the tickets you wrote."}</p>}
    </>
  );
}
