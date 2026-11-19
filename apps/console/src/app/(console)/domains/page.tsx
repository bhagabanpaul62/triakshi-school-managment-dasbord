import { listQueryFrom } from "@smw/feature-kit";
import { DomainAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { dateTime } from "@smw/ui/format";
import { DOMAIN_TONES } from "@/lib/tones";

export const metadata = { title: "Domains" };

const columns: Column[] = [
  { key: "hostname", label: "Address", type: "mono" },
  { key: "schoolName", label: "School" },
  { key: "kind", label: "Kind", type: "badge", labels: { subdomain: "Subdomain", custom: "Custom" }, hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", tones: DOMAIN_TONES },
  { key: "checked", label: "Last checked", hideOnMobile: true },
  { key: "checkError", label: "Problem", hideOnMobile: true },
];

export default async function DomainsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await new DomainAdminService(await requireStaff()).list(listQueryFrom(await searchParams));
  const rows = page.rows.map((d) => ({ ...d, checked: d.lastCheckedAt ? dateTime(d.lastCheckedAt) : null }));
  return (
    <>
      <PageHeader eyebrow="Platform" title="Domains" description="Every address schools use, and whether DNS checks out." />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/schools/{schoolId}"
        searchPlaceholder="Search by address or school"
        filters={[
          { key: "status", label: "Status", options: [{ value: "verified", label: "Verified" }, { value: "pending", label: "Pending" }, { value: "failed", label: "Failed" }] },
          { key: "kind", label: "Kind", options: [{ value: "subdomain", label: "Subdomain" }, { value: "custom", label: "Custom" }] },
        ]}
        empty={{ title: "No domains yet.", description: "Each school gets a subdomain when it is created." }} />
    </>
  );
}
