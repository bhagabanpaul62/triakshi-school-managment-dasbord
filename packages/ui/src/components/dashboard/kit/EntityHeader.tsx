"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import { cn } from "../../../lib/utils";

/**
 * Header for a single record (client, project, person): who/what it is, its state chips, one line of
 * facts, and the actions. Pages pass content; layout, type sizes and spacing live here so every detail page
 * opens the same way. `children` sit under the header (typically the TabBar).
 */
export function EntityHeader({
  back,
  leading,
  title,
  chips,
  meta,
  actions,
  children,
  className,
}: {
  back?: { href: string; label: string };
  /** Logo / avatar, already sized by the caller (56px is the intended size). */
  leading?: ReactNode;
  title: ReactNode;
  /** Status / category chips (ToneBadge). */
  chips?: ReactNode;
  /** Facts for the line under the title; rendered with "·" separators, empty entries skipped. */
  meta?: Array<ReactNode | null | undefined | false>;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const facts = (meta ?? []).filter(Boolean);
  return (
    <header className={cn("flex flex-col gap-5", className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 rounded-md text-[13px] text-[var(--ds-on-surface-muted)] transition-colors duration-150 hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"
        >
          <IconChevronLeft className="h-4 w-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words text-[28px] font-semibold leading-tight tracking-tight text-[var(--ds-on-surface)]">
                {title}
              </h1>
              {chips ? <div className="flex flex-wrap items-center gap-2">{chips}</div> : null}
            </div>
            {facts.length > 0 ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--ds-on-surface-muted)]">
                {facts.map((fact, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <span aria-hidden>·</span> : null}
                    <span className="min-w-0">{fact}</span>
                  </Fragment>
                ))}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {children}
    </header>
  );
}
