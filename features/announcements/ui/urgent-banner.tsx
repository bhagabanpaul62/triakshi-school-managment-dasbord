import { requireCtx } from "@smw/runtime";
import { FeedService } from "../service";
import { HOME } from "./shared";

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
  if (!alerts.length && !closures.length) return null;
  return (
    <div role="alert" className="mb-4 flex flex-col gap-1 rounded-3xl bg-[var(--ds-color-danger-500)]/15 p-4 text-sm text-[var(--ds-color-danger-300)]">
      {alerts.map((a) => (
        <a key={a.id} href={`${HOME}/${a.id}`} className="flex min-h-10 flex-wrap items-center gap-x-2 font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
          <span>Urgent alert: {a.title}</span><span className="font-normal">{a.asksAnswer ? "Open it to tell the school you are safe." : "Open it to read it."}</span>
        </a>
      ))}
      {closures.map((c) => <p key={c.key} className="flex min-h-10 flex-wrap items-center gap-x-2 font-medium">{c.text}</p>)}
    </div>
  );
}
