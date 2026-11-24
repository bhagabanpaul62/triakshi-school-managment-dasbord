import Link from "next/link";
import { notFound } from "next/navigation";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { JournalService } from "../services/journals";
import { PILL, href } from "./styles";
import { JOURNAL_KIND_LABEL, JOURNAL_KIND_TONE } from "./labels";

export const metadata = { title: "Journal entries" };

const columns: Column[] = [
  { key: "number", label: "Entry", type: "mono" },
  { key: "date", label: "Date", type: "date" },
  { key: "memo", label: "Narration" },
  { key: "kind", label: "Kind", type: "badge", tones: JOURNAL_KIND_TONE, labels: JOURNAL_KIND_LABEL, hideOnMobile: true },
  { key: "totalPaise", label: "Amount", type: "money" },
];

export default async function JournalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const svc = new JournalService(await requireCtx());
  if (!svc.can("read")) notFound();
  const query = listQueryFrom(await searchParams);
  const page = await svc.list(query);
  const csv = <a href={href("/app/finance/export/journals", { q: query.q, ...query.filters })} download className={PILL}>CSV</a>;
  const add = svc.can("journal") ? <Link href="/app/finance/journals/new" className="inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">New journal entry</Link> : null;
  return (
    <>
      <PageHeader eyebrow="Finance" title="Journal entries" description="Every posting, newest first. Entries are never edited; a wrong one is undone by another." actions={add} />
      <DataTable columns={columns} rows={page.rows.map((r) => ({ ...r }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/finance/journals/{id}"
        searchPlaceholder="Search by number or narration" toolbar={csv}
        filters={[{ key: "kind", label: "Kind", options: Object.entries(JOURNAL_KIND_LABEL).map(([value, label]) => ({ value, label })) }]}
        empty={{ title: "No entries yet.", description: "Receipts, bills and payroll post here by themselves. A manual entry needs a second person to approve it.", action: add }} />
    </>
  );
}
