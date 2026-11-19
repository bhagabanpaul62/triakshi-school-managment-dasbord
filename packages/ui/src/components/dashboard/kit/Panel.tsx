"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IconArrowUpRight } from "@tabler/icons-react";
import { cn } from "../../../lib/utils";

/** Round tonal chip that holds an icon (the "icon in a circle" from the reference dashboards). */
export function IconChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)]",
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

const ARROW_BASE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)] transition-colors duration-150";

/** The circular "open" arrow in a card's corner. As a link it is keyboard-focusable; as a span it is decoration for a card that is itself the link. */
export function ArrowButton({ href, label, decorative }: { href?: string; label?: string; decorative?: boolean }) {
  const icon = <IconArrowUpRight className="h-4 w-4" strokeWidth={1.8} aria-hidden />;
  if (href && !decorative) {
    return (
      <Link
        href={href}
        aria-label={label ?? "Open"}
        title={label}
        className={cn(ARROW_BASE, "hover:bg-white/[0.12] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]")}
      >
        {icon}
      </Link>
    );
  }
  return <span className={cn(ARROW_BASE, "group-hover/card:bg-white/[0.12] group-hover/card:text-[var(--ds-on-surface)]")}>{icon}</span>;
}

/**
 * The one container every dashboard section lives in: a big-radius tonal panel, a title row with room for
 * a control on the right, then the content. One inset tier is allowed inside (`Inset`), never more.
 */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  /** Right side of the title row: a SegmentedControl, an ArrowButton, a chip. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col rounded-3xl bg-[var(--ds-surface-container-low)] p-6", className)}>
      {title || action ? (
        <header className="mb-4 flex min-h-8 shrink-0 items-center justify-between gap-3">
          {title ? (
            <h3 className="min-w-0 truncate text-[15px] font-medium text-[var(--ds-on-surface)]">{title}</h3>
          ) : (
            <span />
          )}
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </section>
  );
}

/** The single allowed inner tier: a slightly lighter well for a group of related numbers. */
export function Inset({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-white/[0.035] p-4", className)}>{children}</div>;
}
