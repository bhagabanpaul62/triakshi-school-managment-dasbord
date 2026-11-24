import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PlanService } from "../service";
import { BulkIssue } from "./bulk-issue";
import { FeesLookup } from "./lookups";
import { BackLink, Notice, NoAccess, PillLink, can } from "./shared";

export const metadata = { title: "Issue bills from plans" };

export default async function IssueFromPlansPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Issuing bills" who="accountants and admins" home="/app/fees" />;
  const lookup = new FeesLookup(ctx), plans = new PlanService(ctx);
  const [years, classes, published] = await Promise.all([lookup.years(), lookup.classes(), plans.list({ filters: { status: "published" }, pageSize: 100 })]);
  const full = await Promise.all(published.rows.map((p) => plans.get(p.id)));
  const keys = new Map<string, { key: string; label: string; on: string }>();
  for (const p of full) for (const l of p.lines) for (const d of l.dues) { const e = keys.get(d.dueKey); if (!e || d.dueOn < e.on) keys.set(d.dueKey, { key: d.dueKey, label: d.label, on: d.dueOn }); }
  const dueKeys = [...keys.values()].sort((a, b) => a.on.localeCompare(b.on));
  return (
    <>
      <BackLink href="/app/fees/invoices">Bills</BackLink>
      <PageHeader eyebrow="Fees" title="Issue bills from plans" description="Make the bills the published fee plans call for. Look at the result first. A student is never billed twice for the same plan and due." />
      {published.total === 0 ? <Notice action={{ href: "/app/fees/plans", label: "Open fee plans" }}>No plan is published for this year, so there is nothing to issue. Publish a plan first.</Notice> : null}
      <BulkIssue years={years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent }))} classes={classes.map((c) => ({ id: c.id, name: c.name }))} dueKeys={dueKeys.map((k) => ({ key: k.key, label: k.label }))} />
      <div className="mt-6"><PillLink href="/app/fees/opening">Enter opening balances from the old system</PillLink></div>
    </>
  );
}
