import Link from "next/link";
import { cn } from "../../lib/utils";
import { shortDate } from "../../lib/format";
import { TONE, type Tone } from "../dashboard/widgets/WidgetPrimitives";
import { Money } from "./Money";
import { EmptyLine } from "./States";
import { groupByDay } from "./logic";

export interface TimelineItem {
  /** "YYYY-MM-DD" or a full timestamp. A timestamp also shows the time. */
  at: string;
  title: string;
  meta?: string;
  amountPaise?: number;
  tone?: Tone;
  href?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** Shown when there are no items. */
  emptyText?: string;
}

const time = (at: string) => (at.length > 10 ? new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null);

/** Events grouped by day, newest day first. */
export function Timeline({ items, emptyText = "Nothing has happened yet." }: TimelineProps) {
  if (items.length === 0) return <EmptyLine title={emptyText} />;
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(items).map((g) => (
        <section key={g.day} aria-label={shortDate(`${g.day}T00:00:00+05:30`)}>
          <h4 className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{shortDate(`${g.day}T00:00:00+05:30`)}</h4>
          <ol>
            {g.items.map((it, i) => {
              const body = (
                <>
                  <span aria-hidden className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", TONE[it.tone ?? "default"].dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--ds-on-surface)]">{it.title}</span>
                    {it.meta || time(it.at) ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{[time(it.at), it.meta].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  {it.amountPaise !== undefined ? <Money paise={it.amountPaise} tone={it.tone} /> : null}
                </>
              );
              return (
                <li key={i}>
                  {it.href ? (
                    <Link href={it.href} className="flex min-h-10 items-start gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">{body}</Link>
                  ) : (
                    <div className="flex min-h-10 items-start gap-3 px-2 py-1">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
