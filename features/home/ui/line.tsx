import type { ReactNode } from "react";
import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";

/** A panel with nothing to say: one line, with where to go. It keeps its place in the page without taking a box of space. */
export function Line({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  const body = (
    <>
      <span className="shrink-0 text-sm font-medium text-[var(--ds-on-surface)]">{title}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface-muted)]">{children}</span>
      {href ? <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /> : null}
    </>
  );
  const cls = "flex h-full min-h-12 items-center gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] px-5 py-3";
  return href
    ? <Link href={href} data-line className={`${cls} transition-colors hover:bg-[var(--ds-surface-container)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`}>{body}</Link>
    : <div data-line className={cls}>{body}</div>;
}
