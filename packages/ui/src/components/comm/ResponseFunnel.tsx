import Link from "next/link";
import { cn } from "../../lib/utils";
import { TONE, type Tone } from "../../lib/tone";
import { FOCUS } from "../finance/ui";

export interface FunnelPart {
  label: string;
  value: number;
  tone?: Tone;
  href?: string;
}

export interface ResponseFunnelProps {
  /** Parts of the whole, in order: reached, seen, answered yes, answered no, not answered. They add up to the bar. */
  parts: FunnelPart[];
  /** Adds the line "37 of 40 answered, 3 left". */
  progress?: { done: number; total: number; verb?: string };
  className?: string;
}

/** One stacked bar with the numbers beside it, so nobody has to guess what a colour means. */
export function ResponseFunnel({ parts, progress, className }: ResponseFunnelProps) {
  const sum = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const left = progress ? Math.max(0, progress.total - progress.done) : 0;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {progress ? (
        <p className="text-sm text-[var(--ds-on-surface)]">
          <span className="tabular-nums">{progress.done} of {progress.total}</span> {progress.verb ?? "answered"}{left > 0 ? <>, <span className="tabular-nums">{left}</span> left</> : ", all done"}
        </p>
      ) : null}
      <div role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        {sum > 0 ? parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ flexGrow: p.value, flexBasis: 0 }} className={cn("min-w-1", TONE[p.tone ?? "default"].fill)} />) : null}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:flex sm:flex-wrap">
        {parts.map((p) => {
          const inner = (
            <>
              <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", TONE[p.tone ?? "default"].dot)} />
              <span className="min-w-0 truncate text-[var(--ds-on-surface-muted)]">{p.label}</span>
              <span className="font-medium tabular-nums text-[var(--ds-on-surface)]">{p.value}</span>
            </>
          );
          return (
            <li key={p.label} className="min-w-0 text-sm">
              {p.href ? <Link href={p.href} className={cn("flex min-h-8 items-center gap-2 rounded-lg px-1 hover:bg-white/[0.05]", FOCUS)}>{inner}</Link> : <span className="flex min-h-8 items-center gap-2 px-1">{inner}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
