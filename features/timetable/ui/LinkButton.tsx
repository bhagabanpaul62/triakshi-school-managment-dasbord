import Link from "next/link";
import type { ReactNode } from "react";

/** A quiet pill that navigates (a link that looks like the kit's secondary button). */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center rounded-full bg-[var(--ds-surface-container-highest)] px-4 text-sm font-medium text-[var(--ds-on-surface)] transition-colors hover:bg-[var(--ds-surface-container)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
      {children}
    </Link>
  );
}
