import Link from "next/link";
import { IconCheck } from "@tabler/icons-react";
import { Panel } from "@smw/ui/kit/Panel";
import { buttonVariants } from "@smw/ui/ui/button";

export interface SetupStep { key: string; label: string; done: boolean; href: string; who: string | null }

/** What the school still has to set up before its first receipt, in order. The next step is a button; a step this person may not do names who can. */
export function SetupChecklist({ steps, next, pendingPlans }: { steps: SetupStep[]; next: string | null; pendingPlans: number }) {
  const left = steps.filter((s) => !s.done).length;
  return (
    <div className="mb-6">
      <Panel title={`Get ready to collect fees: ${left} step${left === 1 ? "" : "s"} left`}>
        <ol className="flex flex-col gap-1">
          {steps.map((s, i) => (
            <li key={s.key} className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-2">
              <span className="flex min-w-0 items-center gap-3">
                <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${s.done ? "bg-[var(--ds-color-success-500)]/20 text-[var(--ds-color-success-400)]" : "bg-white/[0.07]"}`}>{s.done ? <IconCheck className="h-4 w-4" /> : i + 1}</span>
                <span className={s.done ? "text-[var(--ds-on-surface-muted)] line-through" : ""}>{s.label}<span className="sr-only">{s.done ? ", done" : ", not done"}</span></span>
              </span>
              {s.done ? null : s.who ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Ask {s.who}</span>
                : <Link href={s.href} className={buttonVariants({ variant: s.key === next ? "default" : "ghost", className: "rounded-full" })}>{s.key === "plan" && pendingPlans ? "Approve it" : s.key === next ? "Do this next" : "Open"}</Link>}
            </li>
          ))}
        </ol>
        {pendingPlans ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">{pendingPlans} plan{pendingPlans === 1 ? " is" : "s are"} waiting for an approver. <Link href="/app/finance/approvals" className="underline underline-offset-4">Open approvals</Link></p> : null}
      </Panel>
    </div>
  );
}
