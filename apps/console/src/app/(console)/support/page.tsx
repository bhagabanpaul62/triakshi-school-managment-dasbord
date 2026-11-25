import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { PlanAdminService, SchoolAdminService, SupportDeskService, TICKET_VIEWS, type TicketView } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { cn } from "@smw/ui/utils";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@smw/feature-support/inputs";
import { SLA_LABELS, SLA_TONES, ticketRef } from "@smw/feature-support/labels";
import { PRIORITY_TONES, TICKET_LABELS, TICKET_TONES, statusOptions } from "@/lib/tones";

export const metadata = { title: "Support" };

const VIEW_LABELS: Record<TicketView | "all", string> = { all: "All", new: "New", mine: "Mine", waiting_us: "Waiting on us", overdue: "Overdue", waiting_school: "Waiting on school", solved: "Solved" };
const columns: Column[] = [
  { key: "ref", label: "Ticket", type: "mono", width: "6rem" },
  { key: "subject", label: "Subject", metaKey: "schoolName" },
  { key: "status", label: "Status", type: "badge", tones: TICKET_TONES, labels: TICKET_LABELS },
  { key: "sla", label: "First reply", type: "badge", tones: SLA_TONES, labels: SLA_LABELS },
  { key: "priority", label: "How urgent", type: "badge", tones: PRIORITY_TONES, labels: PRIORITY_LABELS, hideOnMobile: true },
  { key: "category", label: "Type", labels: CATEGORY_LABELS, hideOnMobile: true },
  { key: "planKey", label: "Plan", hideOnMobile: true },
  { key: "assignee", label: "Owner", hideOnMobile: true },
  { key: "lastMessageAt", label: "Last message", type: "date" },
];

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const staff = await requireStaff();
  const svc = new SupportDeskService(staff);
  const query = listQueryFrom(sp);
  const [page, counts, plans, schools] = await Promise.all([
    svc.list(query), svc.viewCounts(), new PlanAdminService(staff).list(), new SchoolAdminService(staff).list(listQueryFrom({ pageSize: "100" })).then((p) => p.rows),
  ]);
  const planOptions = [...new Map(plans.map((p) => [p.key, p.name])).entries()].map(([value, label]) => ({ value, label }));
  const view = (TICKET_VIEWS as readonly string[]).includes(query.filters.view ?? "") ? (query.filters.view as TicketView) : "all";
  const href = (v: string) => { const p = new URLSearchParams(); if (v !== "all") p.set("view", v); if (query.q) p.set("q", query.q); return `/support${p.size ? `?${p}` : ""}`; };
  const rows = page.rows.map((t) => ({ ...t, ref: ticketRef(t.number) }));

  return (
    <>
      <PageHeader eyebrow="Business" title="Support" description="Questions from schools. Each has a reply-by time; overdue ones are mailed to the owner."
        actions={<><Link href="/support/report" className={PILL_BTN}>Reports</Link><Link href="/support/replies" className={PILL_BTN}>Saved replies</Link></>} />
      <nav aria-label="Views" className="custom-scrollbar mb-4 flex gap-1 overflow-x-auto rounded-full bg-white/[0.04] p-1">
        {(["all", ...TICKET_VIEWS] as const).map((v) => (
          <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined} scroll={false}
            className={cn("flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors duration-150", view === v ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]")}>
            {VIEW_LABELS[v]}
            {v !== "all" && counts[v] ? <span className={cn("text-xs tabular-nums", v === "overdue" ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]")}>{counts[v]}</span> : null}
          </Link>
        ))}
      </nav>
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/support/{id}" searchPlaceholder="Search subject, T-1042, school, words"
        filters={[
          { key: "status", label: "Status", options: statusOptions(TICKET_LABELS) },
          { key: "priority", label: "Priority", options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })) },
          { key: "category", label: "Type", options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })) },
          { key: "plan", label: "Plan", options: planOptions },
          { key: "school", label: "School", options: schools.map((x) => ({ value: x.id, label: x.name })) },
          { key: "assigned", label: "Owner", options: [{ value: "me", label: "Mine" }, { value: "none", label: "Nobody yet" }] },
        ]}
        empty={{ title: view === "all" ? "No tickets." : `Nothing in ${VIEW_LABELS[view].toLowerCase()}.`, description: view === "all" ? "When a school asks for help it shows up here." : "Try another view above." }} />
    </>
  );
}
