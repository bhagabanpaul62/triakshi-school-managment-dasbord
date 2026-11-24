import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { RunService } from "../services/runs";
import { PRIMARY_BTN, PILL_BTN, NoAccess, PayNav, RUN_KIND_LABEL, type Search } from "./common";

export const metadata = { title: "Pay runs" };

const columns: Column[] = [
  { key: "label", label: "Run" },
  { key: "kind", label: "Kind", type: "badge", labels: RUN_KIND_LABEL, hideOnMobile: true },
  { key: "status", label: "State", type: "state" },
  { key: "people", label: "People", type: "number", hideOnMobile: true },
  { key: "net", label: "Net pay", type: "money" },
];

export default async function RunsPage({ searchParams }: { searchParams: Search }) {
  const svc = new RunService(await requireCtx());
  if (!svc.can("read")) return <NoAccess what="Pay runs" />;
  const sp = await searchParams;
  const page = await svc.list(listQueryFrom(sp));
  const add = svc.can("manage") ? <Link href="/app/payroll/runs/new" className={PRIMARY_BTN}>New pay run</Link> : null;
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Pay runs" description="One run for each month. A run is worked out, reviewed, approved by a second person and then paid." actions={<><a href="/app/payroll/files/runs-csv" download className={PILL_BTN}>CSV</a>{add}</>} />
      <PayNav active="runs" manager />
      <DataTable columns={columns} rows={page.rows.map((r) => ({ ...r }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/payroll/runs/{id}" searchPlaceholder="Search runs"
        filters={[{ key: "status", label: "State", options: ["draft", "reviewed", "approved", "paid", "cancelled"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) }, { key: "kind", label: "Kind", options: Object.entries(RUN_KIND_LABEL).map(([value, label]) => ({ value, label })) }]}
        empty={{ title: "No pay runs yet.", description: "Start the first one for this month. Pay and days are worked out from your people's pay setup and attendance.", action: add }} />
    </>
  );
}
