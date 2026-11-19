import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { SupportService } from "../service";
import { createTicket } from "./actions";
import { PRIORITY_LABELS, TICKET_LABELS, TICKET_TONES, ticketFields } from "./fields";

export const metadata = { title: "Support" };

const columns: Column[] = [
  { key: "subject", label: "Subject" },
  { key: "status", label: "Status", type: "badge", tones: TICKET_TONES, labels: TICKET_LABELS },
  { key: "priority", label: "Priority", type: "badge", labels: PRIORITY_LABELS, tones: { urgent: "danger", high: "warning" }, hideOnMobile: true },
  { key: "lastMessageAt", label: "Last message", type: "date" },
];

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SupportService(ctx);
  const sp = await searchParams;
  const [page, waiting] = await Promise.all([svc.list(listQueryFrom(sp)), svc.list(listQueryFrom({ status: "pending" }))]);
  const newTicket = <FormModal title="New ticket" icon="support" fields={ticketFields} action={createTicket} submitLabel="Send" values={{ priority: "normal" }} />;

  return (
    <>
      <PageHeader eyebrow="School" title="Support" description={waiting.total ? `${waiting.total} ${waiting.total === 1 ? "ticket is" : "tickets are"} waiting for your reply.` : "Ask the Triakshi team for help. Replies show up here."} actions={svc.can("use") ? newTicket : null} />
      <DataTable
        columns={columns}
        rows={page.rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        rowHref="/app/support/{id}"
        searchPlaceholder="Search tickets"
        filters={[{ key: "status", label: "Status", options: Object.entries(TICKET_LABELS).map(([value, label]) => ({ value, label })) }]}
        empty={{ title: "No tickets yet.", description: "Something not working or unclear? Send us a note.", action: newTicket }}
      />
    </>
  );
}
