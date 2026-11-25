import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ChatBubble } from "@smw/ui/comm/ChatBubble";
import { ConversationLog } from "@smw/ui/comm/ConversationLog";
import { INPUT } from "@smw/ui/shell/FormModal";
import { cn } from "@smw/ui/utils";
import type { ThreadData } from "../core";
import { REVIEWED_LINE, SafeguardService } from "../safeguard";
import { NoSupport, UnreadFallback } from "./empty";
import { ReviewForm } from "./safeguard-forms";
import { PILL_BTN } from "./styles";

export const metadata = { title: "Review a conversation" };

/** Read only. The reviewer got here by typing a reason, and the reason is in the log. */
async function ReviewPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const ctx = await requireCtx();
  if (ctx.supportStaffId) return <NoSupport />;
  const svc = new SafeguardService(ctx);
  let data: ThreadData | null;
  try { data = await svc.viewing(threadId); } catch (e) { if (e instanceof NotFoundError) return <UnreadFallback title="That conversation was not found" text="It may not be yours to review." href="/app/safeguarding" label="Back to concerns" />; throw e; }
  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Safeguarding" title="Open a conversation" description="Type why you need to read it. This is logged." />
        <div className="mx-auto max-w-xl"><Panel><ReviewForm threadId={threadId} /></Panel></div>
      </>
    );
  }
  const told = await svc.told(threadId);
  return (
    <>
      <PageHeader eyebrow="Safeguarding review" title={data.thread.subject} description={`${data.members.map((m) => m.name).join(", ")}${data.thread.studentName ? `. About ${data.thread.studentName}` : ""}. You are reading as a reviewer and you cannot write here.`}
        actions={<Link href="/app/safeguarding" className={PILL_BTN}>Back to concerns</Link>} />
      <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]"><span className="font-medium text-[var(--ds-on-surface)]">What actually happened: </span>{told ? REVIEWED_LINE : "Not told yet. An open concern kept the review quiet."}</p>
      <Panel>
        <ConversationLog className="h-[60dvh]" label={`Review of ${data.thread.subject}`}
          items={data.messages.map((m) => ({
            id: m.id, at: m.at.toISOString(),
            node: <ChatBubble kind={m.kind === "text" ? "message" : m.kind} sender={m.sender} at={m.at.toISOString()} text={m.removed ? `[Removed by the sender] ${m.body}` : m.body}
              files={m.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.type, href: `/api/messages/files/${f.id}` }))} />,
          }))} />
      </Panel>
      <form method="post" action="/api/messages/review-export" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="threadId" value={threadId} />
        <label className="min-w-64 flex-1 text-xs text-[var(--ds-on-surface-muted)]">Reason for a PDF copy (logged)<input name="reason" required minLength={5} maxLength={500} className={cn(INPUT, "mt-1 block w-full")} /></label>
        <button type="submit" className={PILL_BTN}>Download PDF</button>
      </form>
    </>
  );
}

export default function Page(...a: Parameters<typeof ReviewPage>) { return refusalOr(() => ReviewPage(...a)); }
