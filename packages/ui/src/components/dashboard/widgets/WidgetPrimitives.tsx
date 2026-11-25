"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { IconAlertTriangle, IconArrowUpRight, IconRefresh } from "@tabler/icons-react";
import { cn } from "../../../lib/utils";
import { LABEL, ROW_HOVER, TONE, type Tone } from "../../../lib/tone";
import { formatMoneyCompact } from "../../../lib/hooks/useCurrency";
import { CountUp, EASE, rise, stagger } from "../motion";
import { ArrowButton, Panel } from "../kit/Panel";

// Dashboard surfaces follow the Kinetic Monolith rules: tonal layers instead of borders or glows, mono
// uppercase for small labels, colour only where it carries meaning (success / warning / danger / info).
// A widget is ONE panel; everything inside it is flat rows on that panel, never cards inside a card.

export { LABEL, ROW_HOVER, TONE, type Tone } from "../../../lib/tone";

export function WidgetShell({
  title,
  description,
  children,
  className,
  headerAction,
  footer,
  viewAllHref,
  viewAllLabel = "View all",
}: {
  title: string;
  /** Kept as a tooltip: a subtitle under every title was noise that repeated the title. */
  description?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  viewAllHref?: string;
  viewAllLabel?: string;
}) {
  return (
    <Panel
      title={<span title={description}>{title}</span>}
      className={className}
      action={
        <>
          {headerAction}
          {viewAllHref ? <ArrowButton href={viewAllHref} label={viewAllLabel} /> : null}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer ? <footer className="mt-3 shrink-0">{footer}</footer> : null}
    </Panel>
  );
}

export function WidgetFooterActions({
  actions,
}: {
  actions: Array<{
    label: string;
    href?: string;
    onClick?: () => void;
    variant?: "primary" | "secondary";
  }>;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const className = cn(
          "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
          action.variant === "primary"
            ? "bg-[color-mix(in_oklab,var(--ds-color-primary-500)_16%,transparent)] text-[var(--ds-color-primary-200)] hover:bg-[color-mix(in_oklab,var(--ds-color-primary-500)_26%,transparent)]"
            : "bg-white/[0.05] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.09] hover:text-[var(--ds-on-surface)]",
        );

        if (action.href) {
          return (
            <Link key={action.label} href={action.href} className={className}>
              {action.label}
              <IconArrowUpRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Link>
          );
        }

        return (
          <button key={action.label} type="button" onClick={action.onClick} className={className}>
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

export function WidgetEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--ds-on-surface-variant)]">{title}</p>
      <p className="max-w-[28ch] text-xs text-[var(--ds-on-surface-muted)]">{description}</p>
    </div>
  );
}

// Solid amber and a Retry button, so a failed fetch can never be mistaken for the neutral empty state.
export function WidgetErrorState({
  title = "Couldn't load this",
  description = "Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <IconAlertTriangle className="h-5 w-5 text-[var(--ds-color-warning-400)]" aria-hidden />
      <div>
        <p className="text-sm font-medium text-[var(--ds-on-surface)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{description}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-[var(--ds-on-surface-variant)] transition-colors duration-150 hover:bg-white/[0.1] hover:text-[var(--ds-on-surface)]"
        >
          <IconRefresh className="h-3.5 w-3.5" aria-hidden />
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Status / category chip: coloured dot + label on a pale tint. Same value, same look, everywhere. */
export function ToneBadge({ label, tone = "default", className }: { label: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cn(
        // shrink-0 + nowrap: as a flex sibling of a title this must never lose the flex fight and wrap its label.
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE[tone].chip,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} aria-hidden />
      {/* Sentence case: "Up to date", not "Up To Date" (CSS capitalize hits every word). */}
      {typeof label === "string" ? label.charAt(0).toUpperCase() + label.slice(1) : label}
    </span>
  );
}

/** A few headline numbers side by side: no boxes, the numbers are the design. */
export function MiniStatGrid({
  items,
  columns = 3,
}: {
  items: Array<{
    id: string;
    label: string;
    value: string;
    meta?: string;
    tone?: Tone;
    href?: string;
  }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-1",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
      )}
    >
      {items.map((item) => {
        const tone = item.tone ?? "default";
        const content = (
          <>
            <p className={LABEL}>{item.label}</p>
            <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", TONE[tone].text)}>
              <CountUp value={item.value} />
            </p>
            {item.meta ? <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{item.meta}</p> : null}
          </>
        );
        const className = cn("-mx-2 rounded-xl px-2 py-2", item.href && ROW_HOVER);

        return item.href ? (
          <Link key={item.id} href={item.href} className={className}>
            {content}
          </Link>
        ) : (
          <div key={item.id} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

const ROW_LIMIT_FOR_MOTION = 8;

/** Flat rows on the widget panel. An accent shows as a leading dot; everything else stays neutral. */
export function EntityList({
  items,
  empty,
  maxItems = 5,
}: {
  items: Array<{
    id: string | number;
    title: ReactNode;
    subtitle?: ReactNode;
    meta?: ReactNode;
    badge?: ReactNode;
    /** A link or button of its own (a Call link). It sits beside the row, never inside the row's link: an <a> in an <a> breaks hydration. */
    action?: ReactNode;
    /** Avatar or icon chip shown before the text. */
    leading?: ReactNode;
    accent?: Tone;
    /** Deeplink; Cmd/Ctrl+click opens in a new tab. */
    href?: string;
    /** In-place editor (e.g. action sheet). Normal click runs this; modifier+click uses href. */
    onClick?: () => void;
  }>;
  empty: {
    title: string;
    description: string;
  };
  maxItems?: number;
}) {
  const reduce = useReducedMotion();
  if (items.length === 0) {
    return <WidgetEmptyState title={empty.title} description={empty.description} />;
  }

  const visible = items.slice(0, maxItems);
  const remaining = items.length - visible.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <motion.div
        variants={stagger(0.035)}
        initial={reduce ? false : "hidden"}
        animate="show"
        className="custom-scrollbar -mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2"
      >
        {visible.map((item, index) => {
          const href = item.href;
          const interactive = Boolean(href || item.onClick);
          const rowClassName = item.action ? "flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5" : cn("flex items-center gap-3 rounded-2xl px-3 py-2.5", interactive && ROW_HOVER);
          const rowContent = (
            <>
              {item.leading ? <span className="shrink-0">{item.leading}</span> : null}
              {!item.leading && item.accent && item.accent !== "default" ? (
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[item.accent].dot)} aria-hidden />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--ds-on-surface)]">{item.title}</div>
                {item.subtitle ? (
                  <div className="mt-0.5 truncate text-xs text-[var(--ds-on-surface-muted)]">{item.subtitle}</div>
                ) : null}
              </div>
              {item.badge || item.meta ? (
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {item.badge}
                  {item.meta ? (
                    <div className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{item.meta}</div>
                  ) : null}
                </div>
              ) : null}
            </>
          );

          let row: ReactNode;
          if (href) {
            row = (
              <Link
                href={href}
                className={rowClassName}
                onClick={(event) => {
                  if (!item.onClick) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  item.onClick();
                }}
              >
                {rowContent}
              </Link>
            );
          } else if (item.onClick) {
            row = (
              <button type="button" onClick={item.onClick} className={cn(rowClassName, "w-full text-left")}>
                {rowContent}
              </button>
            );
          } else {
            row = <div className={rowClassName}>{rowContent}</div>;
          }
          if (item.action) row = <div className={cn("flex items-center gap-1 rounded-2xl pr-2", interactive && ROW_HOVER)}>{row}{item.action}</div>;

          // Past the first screenful the stagger adds delay without adding polish.
          return index < ROW_LIMIT_FOR_MOTION ? (
            <motion.div key={item.id} variants={rise}>
              {row}
            </motion.div>
          ) : (
            <div key={item.id}>{row}</div>
          );
        })}
      </motion.div>
      {remaining > 0 && (
        <p className="mt-2 text-center text-[11px] text-[var(--ds-on-surface-muted)]">+{remaining} more</p>
      )}
    </div>
  );
}

/** Label and value on one line, a slim bar underneath that grows into place. */
export function ProgressList({
  items,
  empty,
  maxItems = 5,
}: {
  items: Array<{
    id: string | number;
    label: string;
    value: string;
    progress: number;
    meta?: string;
    tone?: Tone;
    href?: string;
  }>;
  empty: {
    title: string;
    description: string;
  };
  maxItems?: number;
}) {
  const reduce = useReducedMotion();
  if (items.length === 0) {
    return <WidgetEmptyState title={empty.title} description={empty.description} />;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {items.slice(0, maxItems).map((item, index) => {
        const pct = Math.max(0, Math.min(100, item.progress));
        const row = (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-[var(--ds-on-surface)]">{item.label}</p>
                {item.meta ? <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{item.meta}</p> : null}
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--ds-on-surface)]">{item.value}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className={cn("h-full rounded-full", TONE[item.tone ?? "default"].fill)}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.1 + index * 0.05 }}
              />
            </div>
          </>
        );
        const className = cn("rounded-xl px-3 py-2.5", item.href && ROW_HOVER);

        return item.href ? (
          <Link key={item.id} href={item.href} className={className}>
            {row}
          </Link>
        ) : (
          <div key={item.id} className={className}>
            {row}
          </div>
        );
      })}
    </div>
  );
}

// currency has no default — callers must pass the agency's configured currency
// (see useCurrency); this just re-exposes formatMoneyCompact under the widget name
// consumers already import.
export function formatCurrencyCompact(value: number, currency: string) {
  return formatMoneyCompact(value, currency);
}

export function formatNumberCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; fill?: string }>;
  label?: string;
  formatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl bg-[color-mix(in_oklab,var(--ds-surface-container-highest)_88%,transparent)] px-3 py-2 text-xs text-[var(--ds-on-surface)] shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      {label ? <p className="mb-1.5 font-medium text-[var(--ds-on-surface-variant)]">{label}</p> : null}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color || entry.fill || "var(--ds-color-primary-400)" }}
          />
          <span className="text-[var(--ds-on-surface-muted)]">{entry.name}</span>
          <span className="ml-auto pl-4 font-medium tabular-nums">
            {formatter ? formatter(entry.value, entry.name) : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Same geometry as a real widget (title bar + rows), so nothing jumps when data arrives. */
export function WidgetLoadingSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] p-6 motion-reduce:animate-none"
      style={{ height }}
      aria-hidden
    >
      <div className="h-3.5 w-28 rounded-md bg-white/[0.07]" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.05]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 rounded-md bg-white/[0.06]" style={{ width: `${82 - i * 12}%` }} />
              <div className="h-2.5 w-1/3 rounded-md bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
