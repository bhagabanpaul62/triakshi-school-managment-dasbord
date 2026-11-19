"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "../motion";
import { cn } from "../../../lib/utils";

export type TabItem<T extends string> = {
  id: T;
  label: string;
  /** A count shown as a small chip (only when > 0 makes sense; pass undefined to hide). */
  count?: number;
  icon?: ReactNode;
};

/**
 * Page-level tabs for a record: scrolls sideways on a phone, sliding active pill, arrow/Home/End keys move
 * between tabs (roving focus). The panel it controls is the caller's job (`aria-controls` via `panelId`).
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
  panelId,
  className,
}: {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Id of the element that shows the active tab's content. */
  panelId?: string;
  className?: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (to: number) => {
    const next = (to + tabs.length) % tabs.length;
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") move(index + 1);
    else if (e.key === "ArrowLeft") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn("-mx-1 overflow-x-auto px-1 scrollbar-hide", className)}>
      <div role="tablist" aria-label={label} className="inline-flex min-w-full items-center gap-1 rounded-full bg-white/[0.05] p-1 sm:min-w-0">
        {tabs.map((tab, i) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-${tab.id}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]",
                active ? "text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]",
              )}
            >
              {active && (
                <motion.span
                  layoutId={`tab-${id}`}
                  transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EASE }}
                  className="absolute inset-0 rounded-full bg-white/[0.12]"
                />
              )}
              <span className="relative flex items-center gap-2">
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && tab.count > 0 ? (
                  <span className="rounded-full bg-white/[0.1] px-1.5 py-px text-[11px] tabular-nums text-[var(--ds-on-surface-variant)]">
                    {tab.count}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
