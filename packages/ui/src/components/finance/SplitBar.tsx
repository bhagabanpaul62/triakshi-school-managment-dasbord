import Link from "next/link";
import { cn } from "../../lib/utils";
import { TONE, type Tone } from "../dashboard/widgets/WidgetPrimitives";
import { Money } from "./Money";
import { formatPaise, shares } from "./logic";

export interface SplitPart {
  label: string;
  paise: number;
  /** Omit for a neutral shade chosen by position; set a tone only when the part means something. */
  tone?: Tone;
  /** Makes the legend row a link (for example the overdue list for that bucket). */
  href?: string;
}

export interface SplitBarProps {
  parts: SplitPart[];
  /** Names the whole, for screen readers: "Collected by method". */
  label: string;
  /** Shown when every part is zero. */
  emptyText?: string;
}

const NEUTRAL = ["bg-white/80", "bg-white/55", "bg-white/35", "bg-white/20", "bg-white/10"];
const fillOf = (p: SplitPart, i: number) => (p.tone ? TONE[p.tone].fill : NEUTRAL[Math.min(i, NEUTRAL.length - 1)]);

/** Parts of a whole as one bar with a legend that carries every value; the bar alone never holds the numbers. */
export function SplitBar({ parts, label, emptyText = "Nothing here yet." }: SplitBarProps) {
  const pct = shares(parts.map((p) => p.paise));
  const total = parts.reduce((s, p) => s + Math.max(0, p.paise), 0);
  const summary = total === 0 ? `${label}: empty` : `${label}: ${parts.map((p, i) => `${p.label} ${formatPaise(p.paise)} (${pct[i]}%)`).join(", ")}`;
  return (
    <div className="min-w-0">
      <div role="img" aria-label={summary} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        {parts.map((p, i) => (pct[i] ? <span key={`${i}-${p.label}`} className={cn("h-full min-w-1", fillOf(p, i))} style={{ width: `${pct[i]}%` }} /> : null))}
      </div>
      {total === 0 ? (
        <p className="mt-3 text-sm text-[var(--ds-on-surface-muted)]">{emptyText}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {parts.map((p, i) => {
            const row = (
              <>
                <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", fillOf(p, i))} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-on-surface-variant)]">{p.label}</span>
                <Money paise={p.paise} size="sm" />
                <span className="w-9 text-right text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{pct[i]}%</span>
              </>
            );
            return (
              <li key={`${i}-${p.label}`}>
                {p.href ? (
                  <Link href={p.href} className="flex min-h-10 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">{row}</Link>
                ) : (
                  <div className="flex min-h-10 items-center gap-2 px-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
