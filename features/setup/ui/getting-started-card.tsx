import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { hideGettingStarted } from "./task-actions";

export interface GettingStartedCardProps {
  percent: number;
  /** Tasks still to do. */
  left: number;
  next: { label: string; href: string; minutes: number } | null;
}

/** One compact card for home: how far the school has come and the next step as the button. Hiding is for the whole school, not one browser. */
export function GettingStartedCard({ percent, left, next }: GettingStartedCardProps) {
  // Past 70% the numbers matter more: a single quiet row instead of a panel.
  if (percent > 70) {
    return (
      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 rounded-3xl bg-[var(--ds-surface-container-low)] px-5 py-2">
        <span className="text-sm font-medium">Getting started</span>
        <span className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface-muted)]">{percent}% done, {left} {left === 1 ? "task" : "tasks"} left{next ? <> · Next: {next.label}</> : null}</span>
        <Link href={next?.href ?? "/app/getting-started"} className="min-h-10 content-center text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">{next ? "Do this next" : "See all tasks"}</Link>
      </div>
    );
  }
  return (
    <Panel title="Getting started" action={<form action={hideGettingStarted}><button type="submit" className="min-h-10 px-2 text-xs text-[var(--ds-on-surface-muted)] underline-offset-4 hover:underline">Hide</button></form>}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm text-[var(--ds-on-surface-variant)]"><span className="font-medium text-[var(--ds-on-surface)]">{percent}% done</span>, {left} {left === 1 ? "task" : "tasks"} left.</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Getting started progress">
            <div className="h-full rounded-full bg-[var(--ds-primary)]" style={{ width: `${percent}%` }} />
          </div>
          {next ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Next: {next.label} <span className="ml-1 tabular-nums">{next.minutes} min</span></p> : null}
        </div>
        {next ? <Button asChild className="rounded-full"><Link href={next.href}>Do this next</Link></Button> : null}
        <Link href="/app/getting-started" className="min-h-10 content-center text-sm text-[var(--ds-on-surface-variant)] underline-offset-4 hover:underline">See all tasks</Link>
      </div>
    </Panel>
  );
}
