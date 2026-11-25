import Link from "next/link";
import { IconBook, IconCash, IconUsers, type Icon } from "@tabler/icons-react";
import { ArrowButton, IconChip } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { stepHref } from "../steps";
import { FinishButton } from "./finish-button";
import { SetupService } from "../service";
import { SetupFrame, loadWizard } from "./frame";

export const metadata = { title: "Setup: Review and finish" };

const NEXT_ACTIONS: { feature: string; href: string; title: string; text: string; icon: Icon }[] = [
  { feature: "students", href: "/app/students", title: "Add your students", text: "Admit them one by one or import a file.", icon: IconUsers },
  { feature: "attendance", href: "/app/attendance", title: "Mark today's attendance", text: "Open a class and tap who is present.", icon: IconBook },
  { feature: "fees", href: "/app/fees", title: "Record a fee", text: "Set up fee types and take the first payment.", icon: IconCash },
];

export default async function DonePage() {
  const { ctx, progress: p } = await loadWizard();
  const shown = p.steps.filter((s) => s.available);
  const open = shown.filter((s) => !s.done);

  if (p.completedAt) {
    const actions = NEXT_ACTIONS.filter((a) => ctx.features.has(a.feature));
    const comm = await new SetupService(ctx).communication().catch(() => []);
    return (
      <SetupFrame current="done" progress={p}>
        <h1 className="text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]">{p.facts.schoolName} is set up</h1>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">
          {p.facts.classes} {p.facts.classes === 1 ? "class" : "classes"} and {p.facts.sections} {p.facts.sections === 1 ? "section" : "sections"} are ready{p.facts.year ? ` for ${p.facts.year.name}` : ""}. Here is what to do first.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {actions.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="group/card flex h-full flex-col gap-4 rounded-2xl bg-white/[0.04] p-4 transition-colors duration-150 hover:bg-white/[0.08]">
                <span className="flex items-center justify-between"><IconChip className="h-9 w-9"><a.icon className="h-4 w-4" aria-hidden /></IconChip><ArrowButton decorative /></span>
                <span><span className="block text-sm font-medium text-[var(--ds-on-surface)]">{a.title}</span><span className="mt-1 block text-xs text-[var(--ds-on-surface-muted)]">{a.text}</span></span>
              </Link>
            </li>
          ))}
        </ul>
        {comm.length ? (
          <>
            <h2 className="mt-8 text-sm font-medium text-[var(--ds-on-surface)]">Talking to families: {comm.filter((c) => c.done).length} of {comm.length} done</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {comm.map((c) => (
                <li key={c.key} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
                  <ToneBadge label={c.done ? "Done" : "To do"} tone={c.done ? "success" : "warning"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--ds-on-surface)]">{c.label}</p>
                    <p className="text-xs text-[var(--ds-on-surface-muted)]">{c.text}</p>
                  </div>
                  <Link href={c.href} className="shrink-0 text-sm text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">{c.done ? "Open" : "Do it"}</Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {open.length ? (
          <p className="mt-6 text-sm text-[var(--ds-on-surface-muted)]">
            Still open: {open.map((s, i) => <span key={s.key}>{i ? ", " : ""}<Link href={stepHref(s.key)} className="text-[var(--ds-on-surface-variant)] underline">{s.label.toLowerCase()}</Link></span>)}. Do them whenever you like.
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/app/getting-started" className="inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-6 text-sm font-medium text-[var(--ds-on-primary)]">See what to do next</Link>
          <Link href="/app" className="flex min-h-10 items-center text-sm text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">Open my dashboard</Link>
        </div>
      </SetupFrame>
    );
  }

  return (
    <SetupFrame current="done" progress={p}>
      <h1 className="text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]">Review and finish</h1>
      <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">
        {open.length ? `${open.length} ${open.length === 1 ? "step is" : "steps are"} still open. You can finish now and come back to them.` : "Everything is in place."}
      </p>
      <ul className="mt-6 flex flex-col gap-2">
        {shown.map((s) => (
          <li key={s.key} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
            <ToneBadge label={s.done ? "Done" : s.required ? "Needed" : s.skipped ? "Later" : "To do"} tone={s.done ? "success" : s.required ? "warning" : "default"} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--ds-on-surface)]">{s.label}</p>
              <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{s.summary ?? s.blurb}</p>
            </div>
            <Link href={stepHref(s.key)} className="shrink-0 text-sm text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">{s.done ? "Change" : "Do it"}</Link>
          </li>
        ))}
      </ul>
      <FinishButton ready={p.ready} back={stepHref(p.available[p.available.length - 1] ?? "year")} />
    </SetupFrame>
  );
}
