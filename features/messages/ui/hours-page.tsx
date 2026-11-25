import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PreferenceService } from "@smw/feature-notifications/prefs";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { HoursForm } from "./hours-form";

export const metadata = { title: "My hours" };

export default async function HoursPage() {
  const ctx = await requireCtx();
  const [mine, school] = await Promise.all([new PreferenceService(ctx).mine(), new CommSettingsService(ctx).get()]);
  return (
    <>
      <PageHeader eyebrow="Messages" title="My hours" description="When you would rather not be pinged, and when you will answer."
        actions={<Link href="/app/messages" className="text-sm text-[var(--ds-on-surface-muted)] underline">Back to messages</Link>} />
      <HoursForm school={{ from: school.quietFrom, to: school.quietTo }} from={mine.quietFrom} to={mine.quietTo} awayUntil={mine.awayUntil} awayText={mine.awayText} />
    </>
  );
}
