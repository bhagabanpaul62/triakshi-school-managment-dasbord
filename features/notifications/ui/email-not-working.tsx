import Link from "next/link";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";

/** Sits next to a person's name when mail to their address bounced or was reported. The page decides with `isSuppressed(tx, address)` and where "Fix" goes. */
export function EmailNotWorking({ fixHref }: { fixHref: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ToneBadge label="Email not working" tone="warning" />
      <Link href={fixHref} className="inline-flex min-h-11 items-center text-sm text-[var(--ds-color-primary-400)] hover:underline">Fix the email</Link>
    </span>
  );
}
