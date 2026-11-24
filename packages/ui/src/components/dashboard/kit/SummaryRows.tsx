"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { IconChevronRight } from "@tabler/icons-react";
import { rise, stagger } from "../motion";
import { IconChip } from "./Panel";
import { TONE, type Tone } from "../../../lib/tone";
import { cn } from "../../../lib/utils";

export type SummaryRow = {
  key: string;
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Danger/warning colours the label, number and icon (the "Anomaly 3" row); neutral by default. */
  tone?: Tone;
  href?: string;
};

/** "Today's summary": icon, label, a number on the right and a chevron. A row only turns colour when it needs action. */
export function SummaryRows({ rows }: { rows: SummaryRow[] }) {
  const reduce = useReducedMotion();
  return (
    <motion.ul variants={stagger(0.05)} initial={reduce ? false : "hidden"} animate="show" className="flex flex-col">
      {rows.map((row, i) => {
        const tone = row.tone ?? "default";
        const content = (
          <>
            {row.icon ? <IconChip className={tone !== "default" ? TONE[tone].chip : undefined}>{row.icon}</IconChip> : null}
            <span className={cn("min-w-0 flex-1 truncate text-sm", tone === "default" ? "text-[var(--ds-on-surface-variant)]" : TONE[tone].text)}>
              {row.label}
            </span>
            <span className={cn("text-base font-medium tabular-nums", tone === "default" ? "text-[var(--ds-on-surface)]" : TONE[tone].text)}>
              {row.value}
            </span>
            {row.href ? <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /> : null}
          </>
        );
        const cls = cn(
          "flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors duration-150",
          row.href && "hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none",
          // A soft separator between rows, never a full border.
          i > 0 && "mt-px",
        );
        return (
          <motion.li key={row.key} variants={rise}>
            {row.href ? (
              <Link href={row.href} className={cls}>
                {content}
              </Link>
            ) : (
              <div className={cls}>{content}</div>
            )}
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
