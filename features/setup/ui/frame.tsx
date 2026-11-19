import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IconCheck } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { LABEL } from "@smw/ui/widgets/WidgetPrimitives";
import { SetupService, type SetupProgress } from "../service";
import { DONE_HREF, stepHref, stepMeta, type StepKey } from "../steps";

/** Every wizard page starts here: only the admin of a school with the wizard may be in it. */
export async function loadWizard() {
  const ctx = await requireCtx();
  if (ctx.role !== "admin" || !ctx.features.has("setup")) redirect("/app");
  const svc = new SetupService(ctx);
  return { ctx, svc, progress: await svc.progress() };
}

/** What is still left, in words, so the admin sees how close the finish is. */
function remaining(p: SetupProgress): string {
  if (p.completedAt) return "Setup is finished. You can change any step again.";
  const left = p.steps.filter((s) => s.available && !s.done);
  const required = left.filter((s) => s.required).length;
  if (required) return `${required} required ${required === 1 ? "step" : "steps"} left before you can finish.`;
  if (left.length) return `${left.length} optional ${left.length === 1 ? "step" : "steps"} left. You can finish any time.`;
  return "Everything is done. One click to finish.";
}

/**
 * The shared page of the wizard: school name, progress ("Step 2 of 7"), the step rail (a row on a phone, a column on a desktop),
 * then the step itself in a panel. Rendered by every page, not by the layout, so the rail is always fresh after a save.
 */
export function SetupFrame({ current, progress: p, children }: { current: StepKey | "done"; progress: SetupProgress; children: ReactNode }) {
  const shown = p.steps.filter((s) => s.available);
  const position = current === "done" ? shown.length : shown.findIndex((s) => s.key === current) + 1;
  const percent = shown.length ? Math.round((p.doneCount / shown.length) * 100) : 0;
  const meta = current === "done" ? null : stepMeta(current);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-10 lg:py-12">
      <aside className="lg:sticky lg:top-12 lg:w-72 lg:shrink-0 lg:self-start">
        <p className={LABEL}>Set up your school</p>
        <p className="mt-1 truncate text-lg font-medium text-[var(--ds-on-surface)]">{p.facts.schoolName}</p>
        <div className="mt-5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Setup progress">
          <div className="flex items-baseline justify-between text-xs text-[var(--ds-on-surface-muted)]">
            <span>{current === "done" ? "Review" : `Step ${position} of ${shown.length}`}</span>
            <span>{p.doneCount} of {shown.length} done</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-[var(--ds-primary)] transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{remaining(p)}</p>
        <nav aria-label="Setup steps" className="-mx-1 mt-5 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {shown.map((s, i) => {
            const active = s.key === current;
            return (
              <Link key={s.key} href={stepHref(s.key)} aria-current={active ? "step" : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors duration-150 ${active ? "bg-white/[0.08] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.04]"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${s.done ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06]"}`}>
                  {s.done ? <IconCheck className="h-3.5 w-3.5" aria-label="Done" /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{s.label}</span>
                {!s.required && !s.done ? <span className="hidden text-[11px] text-[var(--ds-on-surface-muted)] lg:inline">Optional</span> : null}
              </Link>
            );
          })}
          <Link href={DONE_HREF} aria-current={current === "done" ? "step" : undefined}
            className={`flex min-h-10 shrink-0 items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors duration-150 ${current === "done" ? "bg-white/[0.08] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.04]"}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${p.completedAt ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06]"}`}>
              {p.completedAt ? <IconCheck className="h-3.5 w-3.5" aria-label="Done" /> : shown.length + 1}
            </span>
            <span className="whitespace-nowrap">Review and finish</span>
          </Link>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        {meta ? (
          <header className="pb-6 pt-1">
            <h1 className="text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]">{meta.label}</h1>
            <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{meta.blurb}</p>
          </header>
        ) : null}
        <Panel className="p-5 sm:p-7">{children}</Panel>
      </main>
    </div>
  );
}
