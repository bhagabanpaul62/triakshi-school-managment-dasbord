import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import type { Ctx } from "@smw/feature-kit";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { dateTime, shortDate } from "@smw/ui/format";
import { INPUT, type Tone } from "@smw/ui/tone";
import { feedInput } from "../inputs";
import { AnnouncementCategoryService, FeedService, type FeedItem } from "../service";
import { HOME, one, TYPE_LABEL, type Query } from "./shared";

function Card({ n }: { n: FeedItem }) {
  return (
    <li>
      <Link href={`${HOME}/${n.noticeId}`} className="flex min-w-0 flex-col gap-2 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] sm:p-5">
        <span className="flex flex-wrap items-center gap-2">
          {!n.seen && !n.withdrawn ? <><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--ds-primary)]" /><span className="sr-only">Not opened yet</span></> : null}
          {n.type !== "notice" ? <ToneBadge label={TYPE_LABEL[n.type]} tone={n.urgent ? "danger" : "info"} /> : null}
          {n.categoryName ? <ToneBadge label={n.categoryName} tone={(n.categoryTone ?? "default") as Tone} /> : null}
          {n.childName ? <span className="min-w-0 truncate text-xs text-[var(--ds-on-surface-muted)]">For {n.childName}</span> : null}
          {n.pinned && !n.needsAnswer ? <ToneBadge label="Pinned" tone="info" /> : null}
          <time dateTime={n.publishedAt?.toISOString()} className="ml-auto text-xs text-[var(--ds-on-surface-muted)]">{shortDate(n.publishedAt)}</time>
        </span>
        <span className={`break-words text-base text-[var(--ds-on-surface)] ${n.seen ? "font-normal" : "font-medium"}`}>{n.title}</span>
        {n.excerpt ? <span className="line-clamp-2 break-words text-sm text-[var(--ds-on-surface-variant)]">{n.excerpt}</span> : null}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ds-on-surface-muted)]">
          {n.needsAnswer ? <span className="font-medium text-[var(--ds-color-warning-400)]">{n.dueAt ? `Answer by ${dateTime(n.dueAt)}` : "Needs your answer"}</span> : null}
          {n.answered ? <span className="text-[var(--ds-color-success-400)]">You answered</span> : null}
          {!n.answered && !n.needsAnswer && n.responseKind !== "none" && !n.withdrawn ? <span>Answers are closed</span> : null}
          {n.correctedAt ? <span>Updated {dateTime(n.correctedAt)}</span> : null}
        </span>
      </Link>
    </li>
  );
}

const Group = ({ title, items }: { title: string; items: FeedItem[] }) => items.length ? (
  <section aria-label={title} className="flex flex-col gap-2"><h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{title}</h2><ul className="flex flex-col gap-2">{items.map((n) => <Card key={n.recipientId} n={n} />)}</ul></section>
) : null;

/** What a family sees: what needs an answer, what is pinned, then everything else by day. */
export async function Feed({ ctx, sp }: { ctx: Ctx; sp: Query }) {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));
  const parsed = feedInput.safeParse(flat);
  const query = parsed.success ? parsed.data : feedInput.parse({});
  const [feed, categories] = await Promise.all([new FeedService(ctx).feed(query), new AnnouncementCategoryService(ctx).options()]);
  const needs = feed.rows.filter((n) => n.needsAnswer);
  const pinned = feed.rows.filter((n) => !n.needsAnswer && n.pinned);
  const days = new Map<string, FeedItem[]>();
  for (const n of feed.rows.filter((r) => !r.needsAnswer && !r.pinned)) { const k = shortDate(n.publishedAt); days.set(k, [...(days.get(k) ?? []), n]); }
  const filtered = !!(query.q || query.category);
  const link = (page: number) => { const q = new URLSearchParams(Object.entries({ tab: query.tab === "archive" ? "archive" : "", q: query.q ?? "", category: query.category ?? "", page: page > 1 ? String(page) : "" }).filter(([, v]) => v)); return `${HOME}${q.size ? `?${q}` : ""}`; };
  return (
    <>
      <PageHeader eyebrow="Communication" title="Notices" description="What the school has told you. Anything that needs an answer is first." />
      <div className="flex flex-col gap-4">
        <SavedViews views={[{ key: "inbox", label: "Inbox", count: feed.unread }, { key: "archive", label: "Archive" }]} active={query.tab} basePath={HOME} param="tab" label="Notices" params={{ q: query.q, category: query.category }} />
        <form method="get" action={HOME} role="search" className="flex flex-wrap items-center gap-2">
          {query.tab === "archive" ? <input type="hidden" name="tab" value="archive" /> : null}
          <label className="flex h-10 min-w-44 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-4 sm:max-w-xs"><IconSearch className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /><span className="sr-only">Search notices</span>
            <input name="q" defaultValue={query.q} placeholder="Search notices" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ds-on-surface-muted)]" /></label>
          <label className="w-44"><span className="sr-only">Category</span>
            <select name="category" defaultValue={query.category ?? ""} className={INPUT}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button type="submit" className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm font-medium hover:bg-white/[0.12]">Search</button>
          {filtered ? <Link href={link(1).split("?")[0]! + (query.tab === "archive" ? "?tab=archive" : "")} className="text-sm underline">Clear</Link> : null}
        </form>
        {feed.rows.length === 0 ? (
          filtered ? <EmptyLine title="Nothing matches." hint="Try other words, or clear the search." />
            : query.tab === "archive" ? <EmptyLine title="The archive is empty." hint="Notices that have ended move here." />
            : <EmptyLine title="No notices yet." hint="When the school sends one, it shows here and you get a message on your phone." />
        ) : (
          <div className="flex flex-col gap-6">
            <Group title="Needs your answer" items={needs} />
            <Group title="Pinned" items={pinned} />
            {[...days].map(([day, items]) => <Group key={day} title={day} items={items} />)}
          </div>
        )}
        {feed.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-xs text-[var(--ds-on-surface-muted)]">
            <span className="tabular-nums">Page {feed.page} of {feed.pageCount}</span>
            {feed.page > 1 ? <Link href={link(feed.page - 1)} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]"><IconChevronLeft className="h-4 w-4" aria-hidden /></Link> : null}
            {feed.page < feed.pageCount ? <Link href={link(feed.page + 1)} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]"><IconChevronRight className="h-4 w-4" aria-hidden /></Link> : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
