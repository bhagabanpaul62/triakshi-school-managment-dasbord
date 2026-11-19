import { listQueryFrom } from "@smw/feature-kit";
import { SupportDeskService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PRIORITY_TONES, TICKET_LABELS, TICKET_TONES, statusOptions } from "@/lib/tones";

export const metadata = { title: "Support" };

const columns: Column[] = [
  { key: "subject", label: "Subject" },
  { key: "schoolName", label: "School" },
  { key: "status", label: "Status", type: "badge", tones: TICKET_TONES, labels: TICKET_LABELS },
  { key: "priority", label: "Priority", type: "badge", tones: PRIORITY_TONES, hideOnMobile: true },
  { key: "assignee", label: "Owner", hideOnMobile: true },
  { key: "lastMessageAt", label: "Last message", type: "date" },
];

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await new SupportDeskService(await requireStaff()).list(listQueryFrom(await searchParams));
  return (
    <>
      <PageHeader eyebrow="Business" title="Support" description="Questions from schools, newest activity first." />
      <DataTable columns={columns} rows={page.rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/support/{id}" searchPlaceholder="Search tickets"
        filters={[
          { key: "status", label: "Status", options: statusOptions(TICKET_LABELS) },
          { key: "priority", label: "Priority", options: ["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })) },
          { key: "assigned", label: "Owner", options: [{ value: "me", label: "Mine" }, { value: "none", label: "Nobody yet" }] },
        ]}
        empty={{ title: "No tickets.", description: "When a school asks for help it shows up here." }} />
    </>
  );
}
