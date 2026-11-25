import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PreferenceService } from "@smw/feature-notifications/prefs";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { isFamily } from "../core";
import { MessageService } from "../service";
import { HoursForm } from "./hours-form";
import { RepliesPanel } from "./replies-panel";

export const metadata = { title: "My hours" };

export default async function HoursPage() {
  const ctx = await requireCtx();
  const messages = new MessageService(ctx);
  const [mine, school, replies] = await Promise.all([new PreferenceService(ctx).mine(), new CommSettingsService(ctx).get(), messages.savedReplies()]);
  return (
    <>
      <PageHeader eyebrow="Messages" title="My hours and replies" description="When you would rather not be pinged, when you will answer, and the answers you give often."
        actions={<Link href="/app/messages" className="text-sm text-[var(--ds-on-surface-muted)] underline">Back to messages</Link>} />
      <HoursForm school={{ from: school.quietFrom, to: school.quietTo }} from={mine.quietFrom} to={mine.quietTo} awayUntil={mine.awayUntil} awayText={mine.awayText} />
      {isFamily(ctx.role) ? null : <div className="mx-auto mt-3 max-w-2xl"><RepliesPanel replies={replies.map((r) => ({ ...r, mine: !r.shared }))} canShare={messages.can("all")} /></div>}
    </>
  );
}
