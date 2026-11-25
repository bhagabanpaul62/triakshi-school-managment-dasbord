import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { isFamily } from "../core";
import { MessageService } from "../service";
import { NoSupport, UnreadFallback } from "./empty";
import { NewMessageForm } from "./new-message-form";

export const metadata = { title: "New message" };

async function NewMessagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (ctx.supportStaffId) return <NoSupport />;
  const svc = new MessageService(ctx);
  const sp = await searchParams;
  const rules = await svc.startRules();
  const family = isFamily(ctx.role);
  const [children, teachers] = rules.canStart && family ? await Promise.all([svc.children(), svc.contacts()]) : [[], []];
  const pre = typeof sp.student === "string" && !family ? (await svc.students()).find((s) => s.id === sp.student) : undefined;
  return (
    <>
      <PageHeader eyebrow="Messages" title="New message" description={family ? "Write to your child's teacher or the school office. The school can review this conversation." : "Pick the student, not the login. The family is reached through the student."}
        actions={<Link href="/app/messages" className="text-sm text-[var(--ds-on-surface-muted)] underline">Back to messages</Link>} />
      {rules.why ? <UnreadFallback title="You cannot start a message right now" text={rules.why} href="/app/messages" label="Back to messages" /> : (
        <NewMessageForm family={family} children={children} teachers={teachers.map((t) => ({ id: t.id, name: t.name, label: t.label }))} canFiles={rules.settings.attachments}
          student={pre ? { id: pre.id, name: pre.name, label: pre.label } : undefined} />
      )}
    </>
  );
}

export default function Page(...a: Parameters<typeof NewMessagePage>) { return refusalOr(() => NewMessagePage(...a)); }
