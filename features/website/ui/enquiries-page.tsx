import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { EnquiryService, studentLink } from "../service";
import { createEnquiry, deleteEnquiry, updateEnquiry } from "./actions";
import { STATUS_LABELS, enquiryCreateFields, enquiryUpdateFields } from "./fields";

export const metadata = { title: "Enquiries" };

/** The one obvious next move for an enquiry in each stage. */
const NEXT: Partial<Record<string, { status: string; label: string }>> = {
  new: { status: "contacted", label: "Mark called" },
  contacted: { status: "visited", label: "Mark visited" },
  visited: { status: "admitted", label: "Mark admitted" },
};

const columns: Column[] = [
  { key: "studentName", label: "Child", type: "person", metaKey: "parentName" },
  { key: "classApplying", label: "Class", hideOnMobile: true },
  { key: "phone", label: "Phone", type: "mono", hideOnMobile: true },
  { key: "status", label: "Stage", type: "badge", labels: STATUS_LABELS, tones: { new: "info", contacted: "warning", visited: "warning", admitted: "success" } },
  { key: "createdAt", label: "Received", type: "date" },
];

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new EnquiryService(ctx);
  const [page, counts] = await Promise.all([svc.list(listQueryFrom(await searchParams)), svc.counts()]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const todo = page.rows.filter((r) => r.status === "new" || r.status === "contacted").slice(0, 3);
  const add = <FormModal title="Add enquiry" icon="inbox" fields={enquiryCreateFields} action={createEnquiry} submitLabel="Add" values={{ source: "phone" }} />;

  return (
    <>
      <PageHeader eyebrow="Website" title="Admission enquiries" description="Everyone who asked about a seat, from the website or by phone." actions={add} />
      <KpiRow>
        <StatCard label="New" value={String(counts.new)} meta={counts.new ? "Waiting for a call" : "All caught up"} />
        <StatCard label="In progress" value={String(counts.contacted + counts.visited)} meta="Contacted or visited" />
        <StatCard label="Admitted" value={String(counts.admitted)} meta={total ? `${Math.round((counts.admitted / total) * 100)}% of all enquiries` : undefined} />
        <StatCard label="All enquiries" value={String(total)} meta={counts.closed ? `${counts.closed} closed` : undefined} />
      </KpiRow>
      {/* On a phone the row buttons sit off-screen to the right, so the first people to call get their actions here. */}
      {todo.length ? (
        <div className="pb-3 md:hidden"><Panel title="Next to call">
          <ul className="flex flex-col gap-2">{todo.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="block truncate text-sm">{r.studentName}</span><a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} className="text-xs text-[var(--ds-primary)]">Call {r.parentName}</a></span>
              <ActionButton variant="secondary" label={NEXT[r.status]!.label} action={updateEnquiry} values={{ id: r.id, status: NEXT[r.status]!.status, notes: r.notes ?? "" }} successMessage={`${r.studentName} moved on`} />
            </li>))}
          </ul>
        </Panel></div>
      ) : null}
      {/* The kit's sr-only header cell escapes the table's own scroll box on phones; clip it here. */}
      <div className="relative overflow-x-clip">
      <DataTable columns={columns} rows={page.rows} total={page.total} page={page.page} pageCount={page.pageCount}
        searchPlaceholder="Search by child, parent or phone"
        filters={[{ key: "status", label: "Stage", options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })) }]}
        empty={{ title: "No enquiries yet.", description: "Parents who use the form on your website show up here. Add a phone or walk-in enquiry yourself.", action: add }}
        rowActions={Object.fromEntries(page.rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            {NEXT[r.status] ? <ActionButton variant="secondary" label={NEXT[r.status]!.label} action={updateEnquiry} values={{ id: r.id, status: NEXT[r.status]!.status, notes: r.notes ?? "" }}
              successMessage={`${r.studentName} moved on`} /> : null}
            <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} aria-label={`Call ${r.parentName}`} className="inline-flex h-10 items-center rounded-full px-3 text-xs text-[var(--ds-on-surface-variant)] hover:bg-white/[0.06]">Call</a>
            <FormModal title={`${r.studentName}: ${r.parentName}`} description={[r.phone, r.email, r.classApplying, r.message].filter(Boolean).join(" · ")} icon="inbox"
              fields={enquiryUpdateFields} values={r} hidden={{ id: r.id }} action={updateEnquiry} trigger={{ label: "Open", variant: "ghost", size: "sm" }} />
            {r.status !== "admitted" && r.status !== "closed" && ctx.features.has("students") ? (
              <Link href={studentLink(r)} className="inline-flex h-10 items-center rounded-full px-3 text-xs text-[var(--ds-primary)] hover:bg-white/[0.06]">Convert to student</Link>
            ) : null}
            <ActionButton variant="icon-delete" label="Delete enquiry" action={deleteEnquiry} values={{ id: r.id }}
              confirm={{ title: "Delete this enquiry?", body: `${r.studentName}'s enquiry will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
          </span>
        )]))} />
      </div>
    </>
  );
}
