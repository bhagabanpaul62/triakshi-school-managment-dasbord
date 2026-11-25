import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { shortDate } from "@smw/ui/format";
import { FormModal } from "@smw/ui/shell/FormModal";
import { INPUT } from "@smw/ui/tone";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PRIVACY_KIND_WORDS, PRIVACY_STATE_WORDS } from "../data-inputs";
import { DEFAULT_PRIVACY_DAYS, PrivacyService } from "../privacy-service";
import { PRIVACY_KINDS } from "../schema";
import { setPrivacyDays } from "./data-actions";
import { PrivacyNew } from "./privacy-new";
import { STATE_TONES, dueWords } from "./privacy-bits";
import { AdminOnly } from "./states";

export const metadata = { title: "Privacy requests" };

const RETENTION: { what: string; keeps: string; where: string; href?: string }[] = [
  { what: "Website enquiries", keeps: "24 months, then blanked", where: "Enquiries", href: "/app/enquiries" },
  { what: "Sign-in events", keeps: "180 days, then deleted", where: "Sign-in activity", href: "/app/settings/sign-ins" },
  { what: "Data exports", keeps: "7 days, then the file is deleted", where: "Exports", href: "/app/settings/export" },
  { what: "Messages", keeps: "The school's keeping time", where: "Communication settings", href: "/app/settings/communication" },
];

const chip = (on: boolean) => `inline-flex h-10 items-center rounded-full px-4 text-sm transition-colors ${on ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06] text-[var(--ds-on-surface)] hover:bg-white/[0.12]"}`;

/** The register of data requests: who asked, what, when it is due and who answers. Filters are plain links and a search box, kept in the URL. */
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new PrivacyService(ctx);
  if (!svc.can("privacy")) return <AdminOnly title="Privacy requests" />;
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const query = listQueryFrom(params);
  const [page, counts, days, owners] = await Promise.all([svc.list({ ...query, filters: { ...query.filters, state: one("state") || "active" }, pageSize: 25 }), svc.counts(), svc.days(), svc.owners()]);
  const state = one("state") || "active";
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const k of ["q", "state", "kind", "owner", "overdue"]) if (one(k)) next.set(k, one(k));
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page");
    return `/app/settings/privacy${next.size ? `?${next}` : ""}`;
  };
  const pageHref = (p: number) => { const n = new URLSearchParams(href({}).split("?")[1] ?? ""); n.set("page", String(p)); return `/app/settings/privacy?${n}`; };
  return (
    <>
      <PageHeader eyebrow="Your data" title="Privacy requests" description={`Families and staff can ask to see, correct or delete their data. Each request gets a number and must be answered within ${days} days.`}
        actions={<PrivacyNew owners={owners} />} />
      <div className="flex flex-col gap-6">
        <KpiRow>
          <StatCard label="Open requests" value={String(counts.active)} />
          <StatCard label="Late" value={String(counts.overdue)} />
          <StatCard label="Due in 14 days" value={String(counts.dueSoon)} />
        </KpiRow>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/app/settings/privacy" className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
            {state !== "active" ? <input type="hidden" name="state" value={state} /> : null}
            <label className="sr-only" htmlFor="privacy-q">Search requests</label>
            <input id="privacy-q" name="q" defaultValue={one("q")} placeholder="Search by number or name" className={`${INPUT} !rounded-full`} />
            <button type="submit" className={PILL_BTN}>Search</button>
          </form>
          <Link href={href({ state: null })} className={chip(state === "active")}>Open</Link>
          <Link href={href({ state: "active", overdue: "1" })} className={chip(one("overdue") === "1")}>Late</Link>
          <Link href={href({ state: "done", overdue: null })} className={chip(state === "done")}>Done</Link>
          <Link href={href({ state: "all", overdue: null })} className={chip(state === "all")}>All</Link>
          <form action="/app/settings/privacy" className="flex items-center gap-2">
            <label className="sr-only" htmlFor="privacy-kind">Kind</label>
            <select id="privacy-kind" name="kind" defaultValue={one("kind")} className={`${INPUT} !h-10 !w-auto !rounded-full`}>
              <option value="">Any kind</option>{PRIVACY_KINDS.map((k) => <option key={k} value={k}>{PRIVACY_KIND_WORDS[k]}</option>)}
            </select>
            {one("q") ? <input type="hidden" name="q" value={one("q")} /> : null}
            {state !== "active" ? <input type="hidden" name="state" value={state} /> : null}
            <button type="submit" className={PILL_BTN}>Filter</button>
          </form>
        </div>
        {page.rows.length === 0 ? (
          <Panel><WidgetEmptyState title={one("q") || one("kind") || state !== "active" ? "No requests match." : "No open requests."} description="When a family or staff member asks about their data, or you write one down, it appears here with a due date." /></Panel>
        ) : (
          <Panel title={`${page.total} ${page.total === 1 ? "request" : "requests"}`}>
            <ul className="flex flex-col">
              {page.rows.map((r) => {
                const due = dueWords(r);
                return (
                  <li key={r.id}>
                    <Link href={`/app/settings/privacy/${r.id}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
                      <span className="w-24 shrink-0 font-mono text-xs text-[var(--ds-on-surface-muted)]">{r.ref}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--ds-on-surface)]">{r.subjectName}</span>
                        <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{PRIVACY_KIND_WORDS[r.kind]} · {r.ownerName ?? "No owner"} · asked {shortDate(r.createdAt)}</span>
                      </span>
                      {due ? <ToneBadge label={due.text} tone={due.tone} /> : <span className="text-xs text-[var(--ds-on-surface-muted)]">{r.closedAt ? shortDate(r.closedAt) : ""}</span>}
                      <ToneBadge label={PRIVACY_STATE_WORDS[r.state]} tone={STATE_TONES[r.state]} />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {page.pageCount > 1 ? (
              <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--ds-on-surface-muted)]">
                <span className="tabular-nums">Page {page.page} of {page.pageCount}</span>
                <span className="flex gap-2">
                  {page.page > 1 ? <Link href={pageHref(page.page - 1)} className={PILL_BTN}>Newer</Link> : null}
                  {page.page < page.pageCount ? <Link href={pageHref(page.page + 1)} className={PILL_BTN}>Older</Link> : null}
                </span>
              </nav>
            ) : null}
          </Panel>
        )}
        <Panel title="How long things are kept" action={ctx.readOnly ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Answer in {days} days. Your school is read-only, so this cannot be changed now.</span> : <FormModal title="Time to answer" icon="shield" description="Every new request gets this many days. Requests already open keep their date." fields={[{ name: "days", label: "Days to answer", type: "number", required: true, min: 7, max: 180, hint: `Between 7 and 180. The usual is ${DEFAULT_PRIVACY_DAYS}.` }]} values={{ days }} action={setPrivacyDays} trigger={{ label: `Answer in ${days} days`, variant: "secondary", size: "sm", plus: false }} />}>
          <div className="relative overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="py-2 font-normal">What</th><th className="py-2 font-normal">Kept</th><th className="py-2 font-normal">Where to change it</th></tr></thead>
            <tbody>
              {RETENTION.map((x) => (
                <tr key={x.what} className="border-t border-white/[0.05]"><th scope="row" className="py-2 font-normal text-[var(--ds-on-surface)]">{x.what}</th><td className="py-2 text-[var(--ds-on-surface-variant)]">{x.keeps}</td>
                  <td className="py-2">{x.href ? <Link href={x.href} className="text-[var(--ds-primary-text)] hover:underline">{x.where}</Link> : x.where}</td></tr>
              ))}
            </tbody>
          </table></div>
        </Panel>
      </div>
    </>
  );
}
