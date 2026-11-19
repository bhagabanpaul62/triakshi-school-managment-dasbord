import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { initials } from "@smw/ui/format";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { AuditService, type AuditRow } from "../service";
import { AuditFilters } from "./audit-filters";
import { moduleLabel } from "./labels";
import { AdminOnly } from "./states";

export const metadata = { title: "Audit log" };

const TZ = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });

/** "Today", "Yesterday", then "Mon, 17 Nov" (with the year when it is not this year). */
function dayLabel(d: Date) {
  const key = dayKey(d);
  if (key === dayKey(new Date())) return "Today";
  if (key === dayKey(new Date(Date.now() - 86_400_000))) return "Yesterday";
  const sameYear = d.toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric" }) === new Date().toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric" });
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: TZ });
}

/** What happened, in words: the logged summary, or the action and thing it touched when none was written. */
const what = (r: AuditRow) => r.summary ?? `${r.action.replace(/[-_]/g, " ")}${r.entity ? ` ${r.entity.toLowerCase()}` : ""}`.replace(/^./, (c) => c.toUpperCase());

function groupByDay(rows: AuditRow[]) {
  const days: { key: string; label: string; rows: AuditRow[] }[] = [];
  for (const r of rows) {
    const key = dayKey(r.createdAt);
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(r);
    else days.push({ key, label: dayLabel(r.createdAt), rows: [r] });
  }
  return days;
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { const x = Array.isArray(v) ? v[0] : v; if (x && k !== "page") next.set(k, x); }
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `/app/audit?${qs}` : "/app/audit";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new AuditService(ctx);
  if (!svc.can("audit")) return <AdminOnly title="Audit log" />;
  const params = await searchParams;
  const [page, modules, actors] = await Promise.all([svc.list({ ...listQueryFrom(params), pageSize: 30 }), svc.modules(), svc.actors()]);
  const days = groupByDay(page.rows);
  const filtered = ["q", "module", "actor", "from", "to"].some((k) => params[k]);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Audit log" description="Who did what, and when. Entries cannot be edited or deleted." />
      <div className="flex flex-col gap-6">
        <AuditFilters modules={modules.map((m) => ({ value: m, label: moduleLabel(m) }))} actors={actors.map((a) => ({ value: a.id, label: a.name }))} />
        {days.length === 0 ? (
          <Panel><WidgetEmptyState title={filtered ? "Nothing matches these filters." : "Nothing logged yet."} description={filtered ? "Try a wider date range or clear the filters." : "Changes made by you and your staff show up here, newest first."} /></Panel>
        ) : days.map((d) => (
          <Panel key={d.key} title={d.label} action={<span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{d.rows.length} {d.rows.length === 1 ? "change" : "changes"}</span>}>
            <ol className="flex flex-col">
              {d.rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-white/[0.04]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px]" aria-hidden>{r.actor === "System" ? "SY" : initials(r.actor)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--ds-on-surface)]" title={what(r)}>{what(r)}</p>
                    <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{r.actor}</p>
                  </div>
                  <span className="hidden shrink-0 sm:block"><ToneBadge label={moduleLabel(r.module)} /></span>
                  <time dateTime={r.createdAt.toISOString()} className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{clock(r.createdAt)}</time>
                </li>
              ))}
            </ol>
          </Panel>
        ))}
        {page.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm text-[var(--ds-on-surface-muted)]">
            <span className="tabular-nums">Page {page.page} of {page.pageCount} · {page.total.toLocaleString("en-IN")} entries</span>
            <span className="flex gap-2">
              {page.page > 1 ? <Link href={pageHref(params, page.page - 1)} className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-5 text-[var(--ds-on-surface)] hover:bg-white/[0.12]">Newer</Link> : null}
              {page.page < page.pageCount ? <Link href={pageHref(params, page.page + 1)} className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-5 text-[var(--ds-on-surface)] hover:bg-white/[0.12]">Older</Link> : null}
            </span>
          </nav>
        ) : null}
      </div>
    </>
  );
}
