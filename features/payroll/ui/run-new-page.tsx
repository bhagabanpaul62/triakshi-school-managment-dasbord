import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { addMonths, monthStart, todayIST } from "@smw/feature-kit/money";
import { ProfileService } from "../services/profiles";
import { RunService } from "../services/runs";
import { createRun } from "./actions";
import { NoAccess, PILL_BTN, PayNav, monthName } from "./common";
import { RedirectForm } from "./redirect-form";

export const metadata = { title: "New pay run" };

export default async function NewRunPage() {
  const ctx = await requireCtx();
  const runs = new RunService(ctx);
  if (!runs.can("manage")) return <NoAccess what="Starting a pay run" />;
  const people = new ProfileService(ctx);
  const [all, departments, existing] = await Promise.all([people.all(), people.departments(), runs.list({ pageSize: 24, filters: { kind: "monthly" } })]);
  const ready = all.filter((p) => p.hasAssignment);
  const now = monthStart(todayIST());
  const taken = new Set(existing.rows.filter((r) => r.status !== "cancelled").map((r) => r.month));
  const months = [0, 1, 2, 3, 4, 5].map((n) => addMonths(now, -n)).filter((m) => !taken.has(m));
  return (
    <>
      <Link href="/app/payroll/runs" className="mb-2 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Pay runs</Link>
      <PageHeader eyebrow="Payroll" title="New pay run" description="Pick the month. Days come from attendance and leave; you see everything before it is saved for approval." />
      <PayNav active="runs" manager />
      {ready.length === 0 ? (
        <EmptyLine title="Nobody has pay set up yet." hint="A run needs at least one person with a structure and a gross pay." action={<Link href="/app/payroll/people?missing=1" className={PILL_BTN}>Set up pay for your people</Link>} />
      ) : months.length === 0 ? (
        <EmptyLine title="Every recent month already has a run." action={<Link href="/app/payroll/runs" className={PILL_BTN}>Open the pay runs</Link>} />
      ) : (
        <RedirectForm hrefPrefix="/app/payroll/runs/" action={createRun} submitLabel={`Start the run for ${ready.length} people`}
          values={{ month: months[0], kind: "monthly" }} hidden={{ kind: "monthly" }}
          fields={[
            { name: "month", label: "Month", type: "select", required: true, options: months.map((m) => ({ value: m, label: monthName(m) })) },
            { name: "department", label: "Only this department", type: "select", options: departments.map((d) => ({ value: d, label: d })), hint: "Leave empty to include everyone." },
          ]}
          summary={`${ready.length} of ${all.length} people have pay set up. ${all.length - ready.length ? `${all.length - ready.length} will be listed as not included, with a link to fix it.` : ""}`} />
      )}
    </>
  );
}
