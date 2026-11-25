import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { EmptyLine } from "@smw/ui/finance/States";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { shortDate } from "@smw/ui/format";
import { REQUEST_STATE_TONE, REQUEST_STATE_WORDS, VIEWS, type RequestState, type ViewKey } from "../constants";
import { CategoryService } from "../categories";
import { RequestService, type RequestRow } from "../service";
import { StateChip } from "@smw/ui/comm/StateChip";
import { SectionNav, canWriteFor, dueWithAge, isFamilyRole, mayOpen, one, type Search } from "./shared";

export const metadata = { title: "Requests" };

function track(state: RequestState): TrackStep[] {
  const at = { new: 0, assigned: 1, in_progress: 1, waiting: 1, resolved: 2, closed: 3 }[state];
  const labels = ["Received", state === "waiting" ? "Waiting for you" : "Being looked at", "Answered", "Closed"];
  return labels.map((label, i) => ({ label, state: i < at || state === "closed" ? "done" : i === at ? "now" : "todo" }));
}

async function FamilyList({ sp }: { sp: Awaited<Search> }) {
  const ctx = await requireCtx();
  const q = one(sp.q), page = Number(one(sp.page)) || 1;
  const list = await new RequestService(ctx).list({ page, pageSize: 10, q: q || undefined });
  const href = (p: number) => `/app/requests?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  // Needs your answer first.
  const rows = [...list.rows].sort((x, y) => Number(y.state === "waiting") - Number(x.state === "waiting"));
  return (
    <>
      <PageHeader eyebrow="Communication" title="Ask the school" description="One place to ask the school office anything, and to see where each request stands."
        actions={<Link href="/app/requests/new" className={buttonVariants({ className: "rounded-full" })}>Ask the school</Link>} />
      <form role="search" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search your requests" aria-label="Search your requests" className="h-10 min-w-0 flex-1 rounded-full bg-white/[0.05] px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] sm:max-w-xs" />
        <button className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyLine title={q ? `Nothing matches "${q}".` : "You have not asked the school anything yet."} hint={q ? "Try a different word." : "Fees, transport, certificates, a question about school: ask here and follow the answer."}
          action={q ? undefined : <Link href="/app/requests/new" className={buttonVariants({ className: "rounded-full" })}>Ask the school</Link>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/app/requests/${r.id}`} className="block rounded-3xl bg-[var(--ds-surface-container-low)] p-4 transition-colors hover:bg-[var(--ds-surface-container)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] sm:p-5">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.subject}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{r.number} · {r.categoryName} · {shortDate(r.createdAt)}</span></span>
                  <StateChip kind="family_request" state={r.state} />
                </span>
                {r.state === "waiting" ? <span className="mt-3 block rounded-2xl bg-white/[0.06] px-3 py-2 text-sm">The school is waiting for your answer. Open it to reply.</span> : null}
                {r.state === "resolved" ? <span className="mt-3 block rounded-2xl bg-white/[0.06] px-3 py-2 text-sm">The school answered. Open it and tell us if it is solved.</span> : null}
                <span className="mt-4 block"><StatusTrack steps={track(r.state)} label={`Where ${r.number} stands`} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.pageCount > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-3 text-sm text-[var(--ds-on-surface-muted)]">
          {page > 1 ? <Link href={href(page - 1)} className="underline underline-offset-4">Newer</Link> : null}
          <span className="tabular-nums">Page {page} of {list.pageCount}</span>
          {page < list.pageCount ? <Link href={href(page + 1)} className="underline underline-offset-4">Older</Link> : null}
        </nav>
      ) : null}
    </>
  );
}

// Six columns fit 1366 px: the request number sits under its title, and the last column says when it is due and how old it is.
const COLUMNS: Column[] = [
  { key: "subject", label: "Request", metaKey: "number" }, { key: "studentName", label: "Child", type: "person", metaKey: "className" },
  { key: "categoryName", label: "Category", hideOnMobile: true }, { key: "state", label: "State", type: "badge", labels: REQUEST_STATE_WORDS, tones: REQUEST_STATE_TONE },
  { key: "ownerName", label: "Owner", hideOnMobile: true }, { key: "due", label: "Due" },
];

const plain = (r: RequestRow) => ({ ...r, due: dueWithAge(r), dueAt: r.dueAt.toISOString(), createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null });

async function StaffQueue({ sp }: { sp: Awaited<Search> }) {
  const ctx = await requireCtx();
  const svc = new RequestService(ctx);
  const view = (VIEWS.find((v) => v[0] === one(sp.view))?.[0] ?? "mine") as ViewKey;
  const query = listQueryFrom({ ...sp, view });
  const [list, counts, cats] = await Promise.all([svc.list(query), svc.counts(), new CategoryService(ctx).options()]);
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));
  const csv = new URLSearchParams(Object.entries({ ...params, view }).filter(([, v]) => v)).toString();
  const nothing = counts.all === 0;
  return (
    <>
      <PageHeader eyebrow="Communication" title="Requests" description="What families have asked the school: who has it, how long it has waited, what is next."
        actions={<>
          <Link href={`/api/requests/csv?${csv}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>
          {canWriteFor(ctx) ? <Link href="/app/requests/new" className={buttonVariants({ className: "rounded-full" })}>New request</Link> : null}
        </>} />
      <SectionNav ctx={ctx} current="/app/requests" />
      {mayOpen(ctx, "website", "enquiries", ["admin", "accountant"]) ? <p className="-mt-3 mb-4 text-sm text-[var(--ds-on-surface-muted)]">Looking for a parent who has not enrolled yet? See <Link href="/app/enquiries" className="underline underline-offset-4">website enquiries</Link>.</p> : null}
      <div className="mb-4"><SavedViews views={VIEWS.map(([key, label]) => ({ key, label, count: counts[key] }))} active={view} basePath="/app/requests" params={params} label="Queue views" /></div>
      <DataTable columns={COLUMNS} rows={list.rows.map(plain)} total={list.total} page={list.page} pageCount={list.pageCount} rowHref="/app/requests/{id}" searchPlaceholder="Search number, title or child"
        filters={[
          { key: "state", label: "State", options: (Object.keys(REQUEST_STATE_WORDS) as RequestState[]).map((s) => ({ value: s, label: REQUEST_STATE_WORDS[s] })) },
          { key: "category", label: "Category", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        ]}
        empty={nothing
          ? { title: "No requests yet.", description: "Families ask from the Requests page of their login. You can also write one down for a family who called.", action: canWriteFor(ctx) ? <Link href="/app/requests/new" className={buttonVariants({ className: "rounded-full" })}>Write the first request</Link> : undefined }
          : { title: view === "all" ? "Nothing matches these filters." : "Nothing in this view.", description: view === "all" ? "Clear a filter to see more." : "Open All to see every request you may see." }} />
    </>
  );
}

export default async function RequestsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  return isFamilyRole(ctx) ? <FamilyList sp={sp} /> : <StaffQueue sp={sp} />;
}
