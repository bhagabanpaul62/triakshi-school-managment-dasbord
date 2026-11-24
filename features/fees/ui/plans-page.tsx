import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { Panel } from "@smw/ui/kit/Panel";
import { Money } from "@smw/ui/finance/Money";
import { VarianceBar } from "@smw/ui/finance/VarianceBar";
import { HeadService, PlanService } from "../service";
import { FeesLookup } from "./lookups";
import { NoAccess, Notice, PillLink, SectionNav, Tabs, can, one, type Search } from "./shared";
import { CARD, MUTED } from "./styles";

export const metadata = { title: "Fee plans" };

const COLUMNS = [["draft", "Drafts"], ["pending", "Waiting for approval"], ["published", "Published"]] as const;
const columns: Column[] = [{ key: "name", label: "Plan" }, { key: "version", label: "Version", type: "number", hideOnMobile: true }, { key: "status", label: "State", type: "state" }, { key: "classes", label: "Classes", hideOnMobile: true }, { key: "totalPaise", label: "Per year", type: "money" }];

export default async function PlansPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Fee plans" who="accountants and admins" home="/app/fees" />;
  const sp = await searchParams, view = one(sp.view) === "table" ? "table" : "board";
  const svc = new PlanService(ctx), lookup = new FeesLookup(ctx);
  const [years, heads] = await Promise.all([lookup.years(), new HeadService(ctx).options()]);
  const year = years.find((y) => y.id === one(sp.yearId)) ?? years.find((y) => y.isCurrent) ?? years[0];
  const prev = year ? years[years.indexOf(year) + 1] : undefined;
  const base = listQueryFrom(sp);
  const [board, table, hike] = await Promise.all([
    view === "board" && year ? Promise.all(COLUMNS.map(([s]) => svc.list({ page: 1, pageSize: 50, filters: { yearId: year.id, status: s } }))) : null,
    view === "table" && year ? svc.list({ ...base, filters: { ...base.filters, yearId: year.id } }) : null,
    year && prev ? svc.compareYears(prev.id, year.id).catch(() => []) : [],
  ]);
  const total = board ? board.reduce((s, b) => s + b.total, 0) : table?.total ?? 0;
  const href = (patch: Record<string, string>) => { const n = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : []))); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return `/app/fees/plans${n.size ? `?${n}` : ""}`; };

  return (
    <>
      <PageHeader eyebrow="Fees" title="Fee plans" description="What each class pays and when. A plan is approved, then published, then it bills."
        actions={<><PillLink href="/app/fees/heads">Fee heads</PillLink><PillLink href="/app/fees/invoices/issue">Issue bills</PillLink><PillLink href="/app/fees/plans/new" primary>New plan</PillLink></>} />
      <SectionNav ctx={ctx} current="/app/fees/plans" />
      {!heads.length ? <Notice action={{ href: "/app/fees/heads?next=/app/fees/plans/new", label: "Add fee heads" }}>There are no fee heads yet, like Tuition or Transport. A plan is made of them.</Notice> : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex items-center gap-2 text-sm"><input type="hidden" name="view" value={view} />
          <label className="flex items-center gap-2 text-[var(--ds-on-surface-muted)]">Year<select name="yearId" defaultValue={year?.id} className="h-10 rounded-full bg-white/[0.05] px-4 text-sm text-[var(--ds-on-surface)]">{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
          <button type="submit" className="h-10 rounded-full bg-white/[0.07] px-4 font-medium hover:bg-white/[0.12]">Show</button></form>
        <Tabs label="View" tabs={[["board", "Board"], ["table", "Table"]]} current={view} href={(v) => href({ view: v })} />
      </div>

      {total === 0 && view === "board" ? (
        <div className={CARD}><p className="text-sm">No fee plan for {year?.name ?? "this year"} yet.</p><p className={`${MUTED} mt-1`}>Make one, or open last year's plan and copy it to this year.</p><div className="mt-4 flex gap-2"><PillLink href="/app/fees/plans/new" primary>Make the first plan</PillLink>{prev ? <PillLink href={href({ yearId: prev.id })}>Open {prev.name}</PillLink> : null}</div></div>
      ) : view === "board" && board ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map(([s, title], i) => (
            <section key={s} aria-label={title} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
              <h2 className="mb-3 flex items-center justify-between text-sm font-medium">{title}<span className="tabular-nums text-[var(--ds-on-surface-muted)]">{board[i]!.total}</span></h2>
              {board[i]!.rows.length ? (
                <ul className="flex flex-col gap-2">{board[i]!.rows.map((p) => (
                  <li key={p.id}><Link href={`/app/fees/plans/${p.id}`} className="block rounded-2xl bg-white/[0.05] p-3 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                    <span className="flex items-start justify-between gap-2"><span className="font-medium">{p.name}</span><span className={MUTED}>v{p.version}</span></span>
                    <span className={`${MUTED} mt-1 block`}>{p.classNames.slice(0, 4).join(", ")}{p.classNames.length > 4 ? ` and ${p.classNames.length - 4} more` : ""}</span>
                    <span className="mt-2 flex items-center justify-between text-sm"><span className={MUTED}>{p.admissionType === "all" ? "All students" : p.admissionType === "new" ? "New admissions" : "Existing students"}</span><Money paise={p.totalPaise} /></span></Link></li>
                ))}</ul>
              ) : <p className={MUTED}>{s === "draft" ? "No drafts." : s === "pending" ? "Nothing waits for an approver." : "No plan is live yet."}</p>}
            </section>
          ))}
        </div>
      ) : table ? (
        <DataTable columns={columns} rows={table.rows.map((p) => ({ ...p, classes: p.classNames.join(", ") }))} total={table.total} page={table.page} pageCount={table.pageCount} rowHref="/app/fees/plans/{id}" searchPlaceholder="Search plans"
          filters={[{ key: "status", label: "State", options: [{ value: "draft", label: "Draft" }, { value: "pending", label: "Waiting" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }] }]}
          empty={{ title: "No plans match", description: "Try another state or clear the search.", action: <PillLink href="/app/fees/plans/new" primary>New plan</PillLink> }} />
      ) : null}

      {hike.length ? (
        <div className="mt-6"><Panel title={`Fee change since ${prev?.name}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{hike.map((c) => <div key={c.classId}><VarianceBar label={c.name} actual={c.toPaise} budget={c.fromPaise} /><p className="mt-1 flex items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">{c.changePercent === null ? "No plan last year" : `${c.changePercent > 0 ? "+" : ""}${c.changePercent}%`}</p></div>)}</div>
        </Panel></div>
      ) : null}
    </>
  );
}
