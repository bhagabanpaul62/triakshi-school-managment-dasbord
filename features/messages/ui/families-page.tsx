import Link from "next/link";
import { ForbiddenError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { BatchService } from "../batch";
import { NoSupport, UnreadFallback } from "./empty";
import { FamiliesFlow } from "./families-flow";

export const metadata = { title: "Message families" };

async function FamiliesPage() {
  const ctx = await requireCtx();
  if (ctx.supportStaffId) return <NoSupport />;
  const svc = new BatchService(ctx);
  let options;
  try { options = await svc.options(); } catch (e) { if (e instanceof ForbiddenError) return <UnreadFallback title="Only staff can message families" text="Use New message to write to a teacher or the school office." href="/app/messages/new" label="New message" />; throw e; }
  return (
    <>
      <PageHeader eyebrow="Messages" title="Message families" description="One private conversation per family. You follow who has seen it and who answered."
        actions={<Link href="/app/messages/families/sent" className="text-sm text-[var(--ds-on-surface-muted)] underline">Sent before</Link>} />
      <FamiliesFlow options={options} />
    </>
  );
}

export default function Page(...a: Parameters<typeof FamiliesPage>) { return refusalOr(() => FamiliesPage(...a)); }
