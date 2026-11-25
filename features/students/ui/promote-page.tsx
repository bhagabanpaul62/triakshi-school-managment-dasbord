import Link from "next/link";
import { redirect } from "next/navigation";
import { NotFoundError, ValidationError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PromotionService, StudentService } from "../service";
import { promoteSection } from "./actions";
import { promoteFields } from "./fields";

export const metadata = { title: "Promote students" };

export default async function PromotePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (!new StudentService(ctx).can("write")) redirect("/app/students");
  const svc = new PromotionService(ctx);
  const raw = (await searchParams).from;
  const from = Array.isArray(raw) ? raw[0] : raw;

  const sources = await svc.sources();
  const plan = from ? await svc.preview(from).catch((e: unknown) => (e instanceof NotFoundError || e instanceof ValidationError ? null : Promise.reject(e))) : null;
  const withStrength = (t: { id: string; label: string; now: number; joining: number }) =>
    ({ value: t.id, label: `${t.label}: ${t.now} now${t.joining ? `, ${t.joining} joining planned` : ""}` });
  const people = plan?.students.map((s) => ({ value: s.id, label: `${s.name} (${s.admissionNo})` })) ?? [];

  return (
    <>
      <PageHeader eyebrow="Students" title="Promote students" description="At year end, move a section up to next year's class. Pick the section, then say who repeats or leaves." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Panel title="This year's sections">
            {sources.length === 0 ? <WidgetEmptyState title="No sections yet." description="Set up classes and sections in Academics first." /> : (
              <ul className="-mx-2 flex flex-col gap-0.5">
                {sources.map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/students/promote?from=${s.id}`} aria-current={s.id === from ? "page" : undefined}
                      className={`flex items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${s.id === from ? "bg-white/[0.08]" : ""}`}>
                      <span>{s.label}</span>
                      <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{s.students} students</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-8">
          {!plan ? (
            <Panel title="Promotion"><WidgetEmptyState title="Pick a section." description="Choose the section to promote on the left." /></Panel>
          ) : (
            <Panel title={`Promote ${plan.from.label} (${plan.from.yearName})`}
              action={plan.students.length === 0 ? null : (!plan.graduating && plan.promoteTargets.length === 0) ? null : (
                <FormModal title={plan.graduating ? "Graduate this class" : "Promote this section"} icon="users" size="lg" submitLabel={plan.graduating ? "Graduate" : "Promote"}
                  fields={promoteFields({ graduating: plan.graduating, promoteTargets: plan.promoteTargets.map(withStrength), retainTargets: plan.retainTargets.map(withStrength), students: people })}
                  hidden={{ fromSectionId: plan.from.id }} action={promoteSection} redirectTo="/app/students"
                  summary={`${plan.students.length} students in this section`} trigger={{ label: plan.graduating ? "Graduate class" : "Promote section", plus: false }} />
              )}>
              {plan.graduating ? <div className="mb-3"><ToneBadge label="Last class: students become alumni" tone="info" /></div> : null}
              {!plan.graduating && plan.promoteTargets.length === 0 ? (
                <WidgetEmptyState title="No next-year section to move to." description="Create next year's sections in Academics, then come back." />
              ) : plan.students.length === 0 ? (
                <WidgetEmptyState title="No active students in this section." description="Nothing to promote here." />
              ) : (
                <ul className="-mx-2 flex flex-col gap-0.5">
                  {plan.students.map((s) => (
                    <li key={s.id} className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{s.admissionNo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
