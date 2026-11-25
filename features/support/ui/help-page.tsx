import Link from "next/link";
import { IconSearch } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/tone";
import { cn } from "@smw/ui/utils";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { AREAS, ARTICLES, type AreaKey, type Audience } from "../articles";
import { searchArticles } from "../search";
import { SupportService } from "../service";

export const metadata = { title: "Help articles" };

const AUDIENCES: { value: Audience; label: string }[] = [{ value: "admin", label: "Administrators" }, { value: "accountant", label: "Accounts" }, { value: "teacher", label: "Teachers" }];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FOR_LABEL: Record<Audience, string> = { admin: "Administrators", accountant: "Accounts", teacher: "Teachers", everyone: "Everyone" };

/** /app/support/help: search, filter by area and by who it is for, or browse. Written by us and shipped with the product, so the steps match your version. */
export default async function HelpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (ctx.role === "student" || ctx.role === "parent") return <NoAccess title="Help articles are for your school's staff." hint="Ask your school office, or the class teacher, if you need help." />;
  const canAsk = new SupportService(ctx).can("use") && !(ctx.supportStaffId && ctx.readOnly);
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 150);
  const area = (Object.keys(AREAS) as AreaKey[]).find((a) => a === one(sp.area));
  const audience = AUDIENCES.find((a) => a.value === one(sp.for))?.value;
  const found = searchArticles(q, { area, audience });
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: q || undefined, area, for: audience, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/app/support/help${p.size ? `?${p}` : ""}`;
  };
  const chip = (on: boolean) => cn("inline-flex min-h-9 items-center rounded-full px-3 text-sm transition-colors", on ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]");
  const ask = canAsk ? <Link href={`/app/support/new${q ? `?subject=${encodeURIComponent(q)}` : ""}`} className={PRIMARY_BTN}>Ask us</Link> : null;
  const grouped = !q ? (Object.keys(AREAS) as AreaKey[]).map((a) => ({ a, list: found.filter((x) => x.area === a) })).filter((g) => g.list.length) : [];

  return (
    <>
      <PageHeader eyebrow="Support" title="Help articles" description={`${ARTICLES.length} short guides for the questions schools ask most.`} actions={<Link href="/app/support" className={PILL_BTN}>Back to support</Link>} />
      <form action="/app/support/help" method="get" role="search" className="relative mb-4">
        <label htmlFor="help-q" className="sr-only">Search the help articles</label>
        <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <input id="help-q" name="q" type="search" defaultValue={q} placeholder="Try: take a fee, login slips, publish results" className={`${INPUT} pl-11`} autoComplete="off" />
        {area ? <input type="hidden" name="area" value={area} /> : null}
        {audience ? <input type="hidden" name="for" value={audience} /> : null}
      </form>
      <nav aria-label="Filter the articles" className="mb-2 flex flex-wrap gap-2">
        <Link href={href({ area: undefined })} className={chip(!area)} aria-current={!area ? "true" : undefined}>All areas</Link>
        {(Object.keys(AREAS) as AreaKey[]).map((a) => <Link key={a} href={href({ area: a })} className={chip(area === a)} aria-current={area === a ? "true" : undefined}>{AREAS[a]}</Link>)}
      </nav>
      <nav aria-label="Who it is for" className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ds-on-surface-muted)]">For</span>
        <Link href={href({ for: undefined })} className={chip(!audience)}>Everyone</Link>
        {AUDIENCES.map((a) => <Link key={a.value} href={href({ for: a.value })} className={chip(audience === a.value)} aria-current={audience === a.value ? "true" : undefined}>{a.label}</Link>)}
      </nav>

      {found.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/[0.035] p-6">
          <p className="text-sm text-[var(--ds-on-surface)]">{q ? `No article matches "${q}".` : "No article here yet."}</p>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">Try fewer or simpler words, or clear the filters.</p>
          <div className="flex flex-wrap gap-2">{q || area || audience ? <Link href="/app/support/help" className={PILL_BTN}>Clear search</Link> : null}{ask}</div>
        </div>
      ) : q ? (
        <>
          <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">{found.length} {found.length === 1 ? "article" : "articles"} for &ldquo;{q}&rdquo;</p>
          <ArticleList list={found} />
        </>
      ) : (
        <div className="flex flex-col gap-3">{grouped.map((g) => <Panel key={g.a} title={AREAS[g.a]}><ArticleList list={g.list} /></Panel>)}</div>
      )}
      {found.length ? (
        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.035] p-4">
          <p className="text-sm text-[var(--ds-on-surface-variant)]">{canAsk ? "Did not find it?" : "Did not find it? Ask your school's administrator, who can write to us."}</p>{ask}
        </div>
      ) : null}
    </>
  );
}

function ArticleList({ list }: { list: typeof ARTICLES }) {
  return (
    <ul className="flex flex-col">
      {list.map((a) => (
        <li key={a.slug}>
          <Link href={`/app/support/help/${a.slug}`} className="flex min-h-14 flex-col justify-center rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
            <span className="text-sm font-medium text-[var(--ds-on-surface)]">{a.title}</span>
            <span className="text-xs text-[var(--ds-on-surface-muted)]">{a.summary} <span className="whitespace-nowrap">For {a.for.map((x) => FOR_LABEL[x].toLowerCase()).join(", ")}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
