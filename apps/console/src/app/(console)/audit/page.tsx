import { listQueryFrom } from "@smw/feature-kit";
import { AuditAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { dateTime } from "@smw/ui/format";

export const metadata = { title: "Audit log" };

const columns: Column[] = [
  { key: "when", label: "When" },
  { key: "staffName", label: "Who" },
  { key: "summary", label: "What" },
  { key: "schoolName", label: "School", hideOnMobile: true },
  { key: "action", label: "Action", type: "mono", hideOnMobile: true },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await new AuditAdminService(await requireStaff()).platform(listQueryFrom(await searchParams));
  const rows = page.rows.map((r) => ({ ...r, when: dateTime(r.createdAt) }));
  return (
    <>
      <PageHeader eyebrow="Team" title="Audit log" description="Everything staff did in this console, newest first. It cannot be edited." />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search the log"
        empty={{ title: "Nothing logged yet.", description: "Changes made in the console are recorded here." }} />
    </>
  );
}
