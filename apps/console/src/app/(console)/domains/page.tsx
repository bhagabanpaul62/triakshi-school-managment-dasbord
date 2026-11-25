import { listQueryFrom } from "@smw/feature-kit";
import { DomainAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { dateTime, shortDate } from "@smw/ui/format";
import { DOMAIN_LABELS, DOMAIN_TONES } from "@/lib/tones";
import { HEALTH_LABELS, HEALTH_TONES } from "./parts";

export const metadata = { title: "Domains" };

const columns: Column[] = [
  { key: "hostname", label: "Address", type: "mono" },
  { key: "schoolName", label: "School" },
  { key: "status", label: "Status", type: "badge", tones: DOMAIN_TONES, labels: DOMAIN_LABELS },
  { key: "health", label: "Health", type: "badge", tones: HEALTH_TONES, labels: HEALTH_LABELS },
  { key: "cert", label: "Certificate until", hideOnMobile: true },
  { key: "checked", label: "Last checked", hideOnMobile: true },
  { key: "checkError", label: "Problem", hideOnMobile: true },
];

export default async function DomainsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await new DomainAdminService(await requireStaff()).list(listQueryFrom(await searchParams));
  const rows = page.rows.map((d) => ({ ...d, checked: d.lastCheckedAt ? dateTime(d.lastCheckedAt) : null, cert: d.certExpiresAt ? shortDate(d.certExpiresAt) : null }));
  return (
    <>
      <PageHeader eyebrow="Platform" title="Domains" description="Every address schools use, and whether its records and certificate check out. Open one to check it now or release it." />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/domains/{id}"
        searchPlaceholder="Search by address or school"
        filters={[
          { key: "status", label: "Status", options: [{ value: "verified", label: "Verified" }, { value: "pending", label: "Pending" }, { value: "failed", label: "Failed" }] },
          { key: "health", label: "Health", options: [{ value: "broken", label: "Broken" }, { value: "warning", label: "Needs a look" }, { value: "ok", label: "Healthy" }] },
          { key: "kind", label: "Kind", options: [{ value: "subdomain", label: "Subdomain" }, { value: "custom", label: "Custom" }] },
        ]}
        empty={{ title: "No domains match.", description: "Each school gets a subdomain when it is created. Custom domains appear when a school adds one." }} />
    </>
  );
}
