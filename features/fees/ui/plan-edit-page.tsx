import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PlanService } from "../service";
import { PlanEditor } from "./plan-editor";
import { planEditorBase } from "./plan-editor-data";
import { PlanMissing } from "./plan-missing";
import { BackLink, NoAccess, Notice, can } from "./shared";

export const metadata = { title: "Edit fee plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Fee plans" who="accountants and admins" home="/app/fees" />;
  const { id } = await params;
  const v = await new PlanService(ctx).get(id).catch(() => null);
  if (!v) return <><BackLink href="/app/fees/plans">Fee plans</BackLink><Notice tone="danger" action={{ href: "/app/fees/plans", label: "Back to fee plans" }}>This plan does not exist, or it belongs to another school.</Notice></>;
  if (v.plan.status !== "draft") return <><BackLink href={`/app/fees/plans/${id}`}>Plan</BackLink><Notice action={{ href: `/app/fees/plans/${id}`, label: "Open the plan" }}>{v.plan.status === "pending" ? "This plan is waiting for approval. Withdraw it from the plan page to edit it." : "A published plan is never edited. Open it and start a new version."}</Notice></>;
  const { year, years, ...rest } = await planEditorBase(ctx);
  const current = years.find((y) => y.id === v.plan.yearId) ?? year;
  if (!current) return <Notice action={{ href: "/app/academics", label: "Open academics" }}>No academic year is set up yet.</Notice>;
  if (!rest.heads.length || !rest.classes.length) return <><BackLink href={`/app/fees/plans/${id}`}>{v.plan.name}</BackLink><PlanMissing heads={rest.heads.length} classes={rest.classes.length} back={`/app/fees/plans/${id}/edit`} /></>;
  return (
    <>
      <BackLink href={`/app/fees/plans/${id}`}>{v.plan.name}</BackLink>
      <PageHeader eyebrow="Fees" title={`Edit ${v.plan.name}`} description={`Version ${v.plan.version}. A draft: nothing bills from it until it is approved and published.`} />
      <PlanEditor year={{ ...current }} {...rest}
        plan={{ id: v.plan.id, rootId: v.plan.rootId, version: v.plan.version, name: v.plan.name, admissionType: v.plan.admissionType, joinRule: v.plan.joinRule, lateRule: v.plan.lateRule, note: v.plan.note, classIds: v.classes.map((c) => c.id),
          lines: v.lines.map((l) => ({ headId: l.headId, optional: l.optional, dues: l.dues.map((d) => ({ dueKey: d.dueKey, label: d.label, billOn: d.billOn, dueOn: d.dueOn, amountPaise: d.amountPaise })) })) }} />
    </>
  );
}
