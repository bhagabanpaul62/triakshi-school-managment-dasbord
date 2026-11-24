import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PlanEditor } from "./plan-editor";
import { planEditorBase } from "./plan-editor-data";
import { BackLink, NoAccess, Notice, can } from "./shared";

export const metadata = { title: "New fee plan" };

export default async function NewPlanPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Fee plans" who="accountants and admins" home="/app/fees" />;
  const { year, years: _years, ...rest } = await planEditorBase(ctx);
  return (
    <>
      <BackLink href="/app/fees/plans">Fee plans</BackLink>
      <PageHeader eyebrow="Fees" title="New fee plan" description="Pick the classes, add the fees and how often each is charged. Dates are made from the academic year and you can change any of them." />
      {year ? <PlanEditor year={year} {...rest} /> : <Notice action={{ href: "/app/academics", label: "Open academics" }}>No academic year is set up yet. A plan belongs to a year.</Notice>}
    </>
  );
}
