import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { shortDate } from "@smw/ui/format";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { SetupTaskService, type TaskView } from "../task-service";
import { TASKS, canDoTask } from "../tasks";
import { showGettingStarted } from "./task-actions";
import { TaskControls, type PersonOption } from "./task-controls";

export const metadata = { title: "Getting started" };

/** A quiet "10 min" after the reason, so the reason stays a whole sentence. */
const Mins = ({ n }: { n: number }) => <span className="ml-2 whitespace-nowrap tabular-nums">· {n} min</span>;

/** /app/getting-started. The admin sees every task; anyone else, or `?mine=1`, sees what was given to them. */
export default async function GettingStartedPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.features.has("setup")) redirect("/app");
  const svc = new SetupTaskService(ctx);
  const mine = (await searchParams).mine === "1" || !svc.can("run");
  if (mine && !svc.can("task")) redirect("/app");
  return mine ? <Mine svc={svc} admin={svc.can("run")} /> : <All svc={svc} />;
}

async function Mine({ svc, admin }: { svc: SetupTaskService; admin: boolean }) {
  const tasks = await svc.mine();
  return (
    <>
      <PageHeader eyebrow="Getting started" title="Your tasks" description="Things a colleague gave you to set up the school."
        actions={admin ? <Link href="/app/getting-started" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>All tasks</Link> : undefined} />
      {tasks.length ? (
        <Panel>
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium text-[var(--ds-on-surface)]">{t.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{t.why}{t.assignedBy ? ` Given by ${t.assignedBy}${t.assignedAt ? `, ${shortDate(t.assignedAt)}` : ""}.` : ""}<Mins n={t.minutes} /></p>
                  {t.canDo ? null : <p className="mt-1 text-xs text-[var(--ds-color-warning-400)]">Your role cannot open this page. Ask {t.assignedBy ?? "your admin"} to change your role or give the task to someone else.</p>}
                </div>
                {t.canDo ? <Link href={t.href} className={buttonVariants({ className: "rounded-full" })}>Do it</Link> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : <Panel><WidgetEmptyState title="Nothing waiting for you" description="When a colleague gives you a setup task, it shows here and in your notifications." /></Panel>}
    </>
  );
}

function Row({ t, people, readOnly }: { t: TaskView; people: PersonOption[]; readOnly: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-[var(--ds-on-surface)]">{t.label}</p>
          {t.state === "skipped" ? <ToneBadge label="Left out" tone="default" /> : null}
          {t.state === "unchecked" ? <ToneBadge label="Could not check" tone="warning" /> : null}
          {t.assignee ? <ToneBadge label={`With ${t.assignee.name}`} tone="warning" /> : null}
        </div>
        <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{t.why}<Mins n={t.minutes} /></p>
        {t.skipReason ? <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">Left out: {t.skipReason}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {t.state !== "skipped" ? <Link href={t.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Open</Link> : null}
        {readOnly || t.state === "unchecked" ? null : <TaskControls taskKey={t.key} state={t.state === "skipped" ? "skipped" : "todo"} assigneeId={t.assignee?.id ?? null} people={people} />}
      </div>
    </li>
  );
}

async function All({ svc }: { svc: SetupTaskService }) {
  const [p, staff, mineNow] = await Promise.all([svc.progress(), svc.people(), svc.mine().catch(() => [])]);
  const peopleFor = (key: string): PersonOption[] => {
    const def = TASKS.find((d) => d.key === key)!;
    return staff.map((s) => ({ id: s.id, name: s.name, can: canDoTask(def, s) }));
  };
  const done = p.groups.flatMap((g) => g.tasks.filter((t) => t.state === "done").map((t) => ({ ...t, groupLabel: g.label })));
  return (
    <>
      <PageHeader eyebrow="Getting started" title="Getting started" description="Every step to get your school running, read from your own data. Nothing here needs a button to finish."
        actions={mineNow.length ? <Link href="/app/getting-started?mine=1" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Your tasks ({mineNow.length})</Link> : undefined} />

      {p.readOnly ? <p role="status" className="mb-4 text-sm text-[var(--ds-color-warning-400)]">Your school is read-only, so tasks cannot be given, skipped or changed. Renew the plan in Billing to make changes.</p> : null}
      <div className="mb-6">
        <Panel>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-[32px] font-light leading-none tracking-tight text-[var(--ds-on-surface)]">{p.percent}%</p>
              <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{p.done} of {p.total - p.skipped - p.unchecked} done{p.skipped ? `, ${p.skipped} left out` : ""}{p.unchecked ? `, ${p.unchecked} could not be checked just now` : ""}.</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Getting started progress">
                <div className="h-full rounded-full bg-[var(--ds-primary)]" style={{ width: `${p.percent}%` }} />
              </div>
            </div>
            {p.next ? (
              <div className="min-w-0 basis-72">
                <p className="text-xs text-[var(--ds-on-surface-muted)]">Next best step</p>
                <p className="mt-0.5 text-sm font-medium text-[var(--ds-on-surface)]">{p.next.label}</p>
                <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{p.next.why}<Mins n={p.next.minutes} /></p>
                <Link href={p.next.href} className={buttonVariants({ className: "mt-3 rounded-full" })}>Do this next</Link>
              </div>
            ) : <p className="basis-72 text-sm text-[var(--ds-on-surface-variant)]">Everything is done or left out. Well done.</p>}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        {p.groups.filter((g) => g.tasks.some((t) => t.state !== "done")).map((g) => (
          <Panel key={g.key} title={g.label} action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{g.done} of {g.tasks.length} done</span>}>
            <ul className="flex flex-col gap-2">
              {g.tasks.filter((t) => t.state !== "done").map((t) => <Row key={t.key} t={t} people={peopleFor(t.key)} readOnly={p.readOnly} />)}
            </ul>
          </Panel>
        ))}
      </div>

      {done.length ? (
        <details className="mt-6 rounded-3xl bg-white/[0.03] px-5 py-4">
          <summary className="min-h-10 cursor-pointer content-center text-sm text-[var(--ds-on-surface-variant)]">Done ({done.length})</summary>
          <ul className="mt-3 flex flex-col gap-1.5">
            {done.map((t) => <li key={t.key} className="flex items-center justify-between gap-3 text-sm text-[var(--ds-on-surface-muted)]"><span className="min-w-0 truncate">{t.label}</span><span className="shrink-0 text-xs">{t.groupLabel}</span></li>)}
          </ul>
        </details>
      ) : null}

      {p.hidden && !p.readOnly ? (
        <form action={showGettingStarted} className="mt-6">
          <p className="text-sm text-[var(--ds-on-surface-muted)]">The card on your home page is hidden for everyone. <button type="submit" className="min-h-10 underline underline-offset-4">Show it again</button></p>
        </form>
      ) : null}
    </>
  );
}
