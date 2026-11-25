import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { StateChip } from "@smw/ui/comm/StateChip";
import { shortDate } from "@smw/ui/format";
import { REPORT_CATEGORIES, REPORT_CHIP, REPORT_STATE_WORDS } from "../constants";
import { MessageService } from "../service";
import { UnreadFallback } from "./empty";

export const metadata = { title: "My concerns" };

/** Concerns I reported, and where each stands. Only the state is shown, never what the school decided about a person. */
export default async function ConcernsPage() {
  const rows = await new MessageService(await requireCtx()).myReports();
  return (
    <>
      <PageHeader eyebrow="Messages" title="My concerns" description="What you reported, and where it stands."
        actions={<Link href="/app/messages" className="text-sm text-[var(--ds-on-surface-muted)] underline">Back to messages</Link>} />
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/[0.04] p-4">
              <span className="min-w-0"><span className="block truncate text-sm text-[var(--ds-on-surface)]">{r.subject}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{REPORT_CATEGORIES[r.category] ?? r.category}, {shortDate(r.createdAt)}</span></span>
              <span className="flex items-center gap-2"><StateChip kind="report" state={r.state} /></span>
            </li>
          ))}
        </ul>
      ) : <UnreadFallback title="No concerns reported" text="If something in a conversation worries you, open it and choose Report a concern. The school's safeguarding lead is told." href="/app/messages" label="Back to messages" />}
    </>
  );
}
