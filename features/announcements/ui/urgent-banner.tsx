import { requireCtx } from "@smw/runtime";
import { FeedService } from "../service";
import { HOME } from "./shared";
import { UrgentBannerView } from "./urgent-banner-view";

/** Today's or tomorrow's emergency closures, found by the layout (announcements does not read attendance). */
export interface ClosureLine { key: string; text: string }

/** A red banner for the panel layout: it stays on every page until each urgent alert sent to this person has been opened, and says what is closed today or tomorrow. */
export async function UrgentBanner({ closures = [] }: { closures?: ClosureLine[] }) {
  let alerts: Awaited<ReturnType<FeedService["urgentUnopened"]>>;
  try {
    const ctx = await requireCtx();
    alerts = !ctx.features.has("announcements") || ctx.supportStaffId ? [] : await new FeedService(ctx).urgentUnopened();
  } catch (e) {
    // A redirect or notFound must still reach Next; any other failure must not break every page for a banner.
    if (String((e as { digest?: unknown })?.digest ?? "").startsWith("NEXT_")) throw e;
    alerts = [];
  }
  return <UrgentBannerView alerts={alerts} closures={closures} home={HOME} />;
}
