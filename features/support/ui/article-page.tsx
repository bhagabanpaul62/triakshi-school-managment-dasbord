import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { AREAS, articleBySlug } from "../articles";
import { SupportService } from "../service";
import { voteArticle } from "./actions";
import { ArticleVote } from "./article-vote";

/** `**Menu name**` in an article is shown in bold: it is a word the person will see on screen. */
const bold = (text: string) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-medium text-[var(--ds-on-surface)]">{part}</strong> : part));

const FOR_LABEL = { admin: "Administrators", accountant: "Accounts", teacher: "Teachers", everyone: "Everyone" } as const;

/** /app/support/help/[slug]: numbered steps with the menu names as they are, links into the app, related articles, "Was this useful?" and "Still stuck?". */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCtx();
  if (ctx.role === "student" || ctx.role === "parent") return <NoAccess title="Help articles are for your school's staff." hint="Ask your school office, or the class teacher, if you need help." />;
  const a = articleBySlug(slug);
  if (!a) notFound();
  const canAsk = new SupportService(ctx).can("use") && !(ctx.supportStaffId && ctx.readOnly);
  const related = a.related.map((r) => articleBySlug(r)).filter((x) => !!x);

  return (
    <>
      <EntityHeader back={{ href: "/app/support/help", label: "Help articles" }} title={a.title} chips={<ToneBadge label={AREAS[a.area]} />}
        meta={[`For ${a.for.map((x) => FOR_LABEL[x].toLowerCase()).join(", ")}`, a.summary]} />
      <div className="h-8" />
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <Panel title="Steps">
          <ol className="flex flex-col gap-3">
            {a.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-[var(--ds-on-surface-variant)]">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs tabular-nums text-[var(--ds-on-surface)]">{i + 1}</span>
                <span className="pt-0.5"><span className="sr-only">Step {i + 1}: </span>{bold(s)}</span>
              </li>
            ))}
          </ol>
        </Panel>
        {a.notes?.length ? <Panel title="Good to know"><ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-[var(--ds-on-surface-variant)]">{a.notes.map((n) => <li key={n}>{bold(n)}</li>)}</ul></Panel> : null}
        <Panel title="Open it in the app"><div className="flex flex-wrap gap-2">{a.links.map((l) => <Link key={l.href} href={l.href} className={PILL_BTN}>{l.label}</Link>)}</div></Panel>
        {related.length ? <Panel title="Related"><ul className="flex flex-col">{related.map((r) => <li key={r!.slug}><Link href={`/app/support/help/${r!.slug}`} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.06]">{r!.title}</Link></li>)}</ul></Panel> : null}
        <div className="flex flex-col gap-4 rounded-2xl bg-white/[0.035] p-4">
          <ArticleVote slug={a.slug} action={voteArticle} />
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">{canAsk ? "Still stuck? We will see which article you read." : "Still stuck? Ask your school's administrator, who can write to us."}</p>
            {canAsk ? <Link href={`/app/support/new?article=${a.slug}&subject=${encodeURIComponent(a.title)}`} className={PRIMARY_BTN}>Ask us</Link> : null}
          </div>
        </div>
      </div>
    </>
  );
}
