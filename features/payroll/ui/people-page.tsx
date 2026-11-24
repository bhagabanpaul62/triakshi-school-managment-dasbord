import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ProfileService } from "../services/profiles";
import { checkPaySheet, commitRaise, importPaySheet, previewRaise } from "./actions";
import { NoAccess, PILL_BTN, PayNav, type Search } from "./common";
import { ImportTool, RaiseTool } from "./people-tools";

export const metadata = { title: "Pay and people" };

const columns: Column[] = [
  { key: "name", label: "Person", type: "person", metaKey: "employeeId" },
  { key: "department", label: "Department", hideOnMobile: true },
  { key: "structure", label: "Structure", hideOnMobile: true },
  { key: "grossPaise", label: "Gross a month", type: "money" },
  { key: "payBy", label: "Paid by", type: "badge", labels: { bank: "Bank", cash: "Cash", cheque: "Cheque" }, hideOnMobile: true },
  { key: "missingText", label: "Missing", type: "text" },
];

export default async function PeoplePage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const svc = new ProfileService(ctx);
  if (!svc.can("read")) return <NoAccess what="Pay and people" />;
  const sp = await searchParams;
  const [page, departments] = await Promise.all([svc.list(listQueryFrom({ ...sp, missing: sp.missing })), svc.departments()]);
  const manage = svc.can("manage");
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Pay and people" description="Everyone on the staff list, what they are paid and what is still missing before they can be paid properly."
        actions={<><a href="/app/payroll/files/people-csv" download className={PILL_BTN}>CSV</a>{manage ? <><ImportTool check={checkPaySheet} commit={importPaySheet} /><RaiseTool preview={previewRaise} commit={commitRaise} departments={departments} today={todayIST()} /></> : null}</>} />
      <PayNav active="people" manager />
      <DataTable columns={columns} rows={page.rows.map((r) => ({ ...r, missingText: r.missing.map((m) => m.text).join(", ") }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/payroll/people/{id}"
        searchPlaceholder="Search by name or ID"
        filters={[{ key: "department", label: "Department", options: departments.map((d) => ({ value: d, label: d })) }, { key: "missing", label: "Missing details", options: [{ value: "1", label: "Has something missing" }] }, { key: "state", label: "Who", options: [{ value: "left", label: "Left the school" }] }]}
        empty={{ title: "No staff yet.", description: "Payroll pays the people on your staff list. Add them there first.", action: <a href="/app/staff" className={PILL_BTN}>Open staff</a> }} />
    </>
  );
}
