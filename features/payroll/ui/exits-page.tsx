import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ExitService } from "../services/exits";
import { NoAccess, PILL_BTN, PRIMARY_BTN, PayNav, type Search } from "./common";

export const metadata = { title: "Exits" };
const columns: Column[] = [
  { key: "name", label: "Person", type: "person" },
  { key: "lastDay", label: "Last day", type: "date" },
  { key: "reason", label: "Reason", hideOnMobile: true },
  { key: "status", label: "State", type: "state" },
  { key: "netPaise", label: "Settlement", type: "money" },
];

export default async function ExitsPage({ searchParams }: { searchParams: Search }) {
  const svc = new ExitService(await requireCtx());
  if (!svc.can("read")) return <NoAccess what="Exits" />;
  const page = await svc.list(listQueryFrom(await searchParams));
  const start = svc.can("manage") ? <Link href="/app/payroll/exits/new" className={PRIMARY_BTN}>Start an exit</Link> : null;
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Exits" description="Final pay for people who leave: salary to the last day, leave, notice, gratuity and what they owe the school." actions={<><a href="/app/payroll/files/exits-csv" download className={PILL_BTN}>CSV</a>{start}</>} />
      <PayNav active="exits" manager />
      <DataTable columns={columns} rows={page.rows.map((r) => ({ ...r }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/payroll/exits/{id}" searchPlaceholder="Search by person"
        filters={[{ key: "status", label: "State", options: ["draft", "pending", "approved", "paid", "rejected"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) }]}
        empty={{ title: "No exits.", description: "When someone leaves, start their final settlement here. It is worked out, approved by a second person and paid like a pay run.", action: start }} />
    </>
  );
}
