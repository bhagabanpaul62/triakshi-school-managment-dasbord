import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { FileList } from "@smw/ui/comm/FileList";
import { Markdown } from "@smw/ui/comm/Markdown";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { dateTime } from "@smw/ui/format";
import type { Tone } from "@smw/ui/tone";
import { stop } from "../content";
import { FeedService, type FeedNotice } from "../service";
import { AnswerCard } from "./answer-form";
import { BackLink, HOME, LinkButton, Notice, RelatedLinks, TYPE_LABEL, type Related } from "./shared";

/** One notice as the person it was sent to reads it: what to answer first, then the words, files and the way to ask. */
export async function FamilyRecord({ ctx, id, lang, related = [] }: { ctx: Ctx; id: string; lang?: string; related?: Related[] }) {
  let n: FeedNotice;
  try { n = await new FeedService(ctx).open(id, lang === undefined ? {} : { lang: lang === "main" ? null : lang }); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const asks = n.response.kind !== "none" && !n.withdrawn;
  const askAbout = ctx.features.has("requests") && !ctx.supportStaffId
    ? `/app/requests/new?${new URLSearchParams({ about: n.withdrawn ? "A withdrawn notice" : `Notice: ${n.content?.title ?? ""}`, href: `${HOME}/${n.id}` })}` : null;
  const switchTo = n.other;
  return (
    <>
      <BackLink href={HOME}>Notices</BackLink>
      <PageHeader eyebrow={n.urgent ? "Urgent alert" : n.type === "circular" ? "Circular" : "Notice"} title={n.withdrawn ? "Withdrawn by the school" : n.content?.title ?? ""}
        description={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {n.type !== "notice" ? <ToneBadge label={TYPE_LABEL[n.type]} tone={n.urgent ? "danger" : "info"} /> : null}
          {n.category ? <ToneBadge label={n.category.name} tone={n.category.tone as Tone} /> : null}
          {n.number ? <span className="font-mono text-xs">{n.number}</span> : null}
          <span>{n.publishedAt ? `Sent ${dateTime(n.publishedAt)}` : ""}{n.correctedAt ? ` · Updated ${dateTime(n.correctedAt)}` : ""}</span>
        </span>} />
      <div className="flex max-w-3xl flex-col gap-4">
        {n.withdrawn ? <Notice tone="warning">The school withdrew this notice{n.withdrawn.reason ? `: ${stop(n.withdrawn.reason)}` : "."} Please do not act on what it said. It was withdrawn {dateTime(n.withdrawn.at)}.</Notice> : null}
        {ctx.supportStaffId ? <Notice>Answers are not shown in a support session.</Notice> : null}
        {asks && !ctx.supportStaffId ? (
          <section aria-label="Your answer" className="flex flex-col gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6">
            <h2 className="text-[15px] font-medium text-[var(--ds-on-surface)]">{n.urgent ? "Tell the school you are safe" : n.answering === "open" ? "Your answer" : "Your answer (closed)"}</h2>
            {n.answering === "open" && n.dueAt ? <p className="text-sm text-[var(--ds-on-surface-muted)]">Answer by {dateTime(n.dueAt)}. You can change it until then.</p> : null}
            {n.recipients.map((r) => (
              <AnswerCard key={r.recipientId} noticeId={n.id} recipientId={r.recipientId} childName={r.name} showChild={n.recipients.length > 1} spec={n.response} urgent={n.urgent} dueAt={n.dueAt?.toISOString() ?? null}
                answering={n.answering === "none" ? "closed" : n.answering} guardian={r.guardian} given={r.answer ? { ...r.answer, at: r.answer.at.toISOString() } : null} />
            ))}
          </section>
        ) : null}
        {n.content ? (
          <section aria-label="The notice" className="flex flex-col gap-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6">
            {switchTo ? (
              <nav aria-label="Language" className="flex flex-wrap gap-2">
                <span className="inline-flex min-h-10 items-center rounded-full bg-[var(--ds-on-surface)] px-4 text-sm font-medium text-[var(--ds-surface)]">{n.content.lang ?? "Main language"}</span>
                <LinkButton href={`${HOME}/${n.id}?lang=${switchTo.lang ?? "main"}`}>{switchTo.lang ?? "Main language"}</LinkButton>
              </nav>
            ) : null}
            <Markdown source={n.content.body} className="text-base leading-7" />
            <FileList files={n.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.contentType, href: `/api/notices/files/${f.id}` }))} />
          </section>
        ) : null}
        {n.withdrawn ? null : <RelatedLinks related={related} />}
        {askAbout ? <p className="text-sm"><LinkButton href={askAbout}>Ask about this</LinkButton></p> : null}
      </div>
    </>
  );
}
