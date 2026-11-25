import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { AudienceService } from "@smw/feature-notifications/audience";
import { type Audience } from "@smw/feature-notifications/audience-rules";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NOTICE_TYPES, type NoticeType } from "../constants";
import { isWebsiteOnly } from "../content";
import { AnnouncementCategoryService, NoticeService, TemplateService, type NoticeView } from "../service";
import { NoticeForm, type FormInitial } from "./notice-form";
import { BackLink, HOME, LinkButton, Notice, one, type Query } from "./shared";
import { toIstInput } from "@smw/feature-kit/words";

export const metadata = { title: "Write a notice" };
const NONE: Audience = { include: [], exclude: [] };

async function Screen({ ctx, initial, title, back, banner }: { ctx: Ctx; initial: FormInitial; title: string; back: { href: string; label: string }; banner?: React.ReactNode }) {
  const svc = new NoticeService(ctx);
  const may = svc.mayDo();
  const [options, categories, settings] = await Promise.all([new AudienceService(ctx).options(), new AnnouncementCategoryService(ctx).options(), new CommSettingsService(ctx).get()]);
  const labels = await svc.labelsFor(initial.audience);
  const defaultMode = may.publish && (!initial.audience.include.length || (await svc.reachFor(initial.audience).then((r) => r.mode, () => "approval" as const)) === "free") ? "free" : "approval";
  return (
    <>
      <BackLink href={back.href}>{back.label}</BackLink>
      <PageHeader eyebrow="Communication" title={title} description={initial.mode === "correct" ? "People see the new version with an Updated stamp. The old one is kept." : "Saved as you type. Nothing is sent until you press the button at the bottom."} />
      {banner}
      <NoticeForm initial={initial} categories={categories} options={options} labels={labels} languages={settings.languages} attachments={settings.attachments} may={may}
        defaultMode={defaultMode} quiet={{ from: settings.quietFrom, to: settings.quietTo, sundays: settings.quietSundays }} readOnly={ctx.readOnly} />
    </>
  );
}

const refuse = (text: string, back = HOME) => <><BackLink href={back}>Notices</BackLink><Notice tone="warning">{text}</Notice></>;

/** /app/announcements/new: a blank notice, or one started from a template (`?template=`) or a kind (`?type=`). */
export default async function NewNoticePage({ searchParams }: { searchParams: Promise<Query> }) {
  const [ctx, sp] = await Promise.all([requireCtx(), searchParams]);
  if (ctx.role === "student" || ctx.role === "parent") notFound();
  const svc = new NoticeService(ctx);
  const may = svc.mayDo();
  if (!may.draft) return refuse("Your role cannot write notices. Ask the school admin to give you the right to write them.");
  const asked = one(sp.type), type: NoticeType = (NOTICE_TYPES as readonly string[]).includes(asked ?? "") && (asked !== "urgent" || may.urgent) ? (asked as NoticeType) : "notice";
  const [options, categories, templates] = await Promise.all([new AudienceService(ctx).options(), new AnnouncementCategoryService(ctx).options(), new TemplateService(ctx).list()]);
  const tpl = templates.find((x) => x.id === one(sp.template)), t = tpl?.draft;
  const kind = t?.type && (t.type !== "urgent" || may.urgent) ? t.type : type;
  const initial: FormInitial = {
    id: null, mode: "draft", type: kind, categoryId: categories.find((c) => c.name.toLowerCase() === t?.categoryName?.toLowerCase())?.id ?? "",
    title: t?.title ?? "", body: t?.body ?? "", lang2: "", title2: "", body2: "",
    // A teacher starts with their own sections chosen: the most common notice is to their own class.
    audience: ctx.role === "teacher" && options.mySections.length ? { include: options.mySections.map((id) => ({ type: "section", id })), exclude: [] } : NONE,
    response: kind === "urgent" ? { kind: "ack" } : t?.response ?? { kind: "none" }, dueAt: "", reminders: { before: true, onDay: true, after: true }, website: "app", pinnedUntil: "", expiresAt: "", files: [],
  };
  return <Screen ctx={ctx} initial={initial} title={tpl ? `New from ${tpl.name}` : kind === "circular" ? "New circular" : kind === "urgent" ? "New urgent alert" : "New notice"} back={{ href: HOME, label: "Notices" }} />;
}

const initialOf = (v: NoticeView): FormInitial => {
  const n = v.notice;
  return {
    id: n.id, mode: v.can.edit ? "draft" : "correct", type: n.type, categoryId: n.categoryId ?? "", title: n.title, body: n.body, lang2: n.lang2 ?? "", title2: n.title2 ?? "", body2: n.body2 ?? "",
    audience: n.audience.include.length ? n.audience : NONE, response: n.response, dueAt: toIstInput(n.dueAt), reminders: n.reminders,
    website: isWebsiteOnly(n) ? "only" : n.website ? "site" : "app", pinnedUntil: toIstInput(n.pinnedUntil), expiresAt: toIstInput(n.expiresAt), files: v.files,
  };
};

/** /app/announcements/[id]/edit: keep writing a draft, or correct one that is out. */
export async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const [ctx, { id }] = await Promise.all([requireCtx(), params]);
  if (ctx.role === "student" || ctx.role === "parent") notFound();
  let view: NoticeView;
  try { view = await new NoticeService(ctx).get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const here = `${HOME}/${id}`;
  if (!view.can.edit && !view.can.correct) {
    return <><BackLink href={here}>Back to the notice</BackLink><Notice tone="warning">This notice cannot be changed now: {view.notice.state === "waiting" ? "it is waiting for approval. Take it back first if you want to change it." : view.notice.state === "withdrawn" ? "it was withdrawn. Copy it to a new draft to send it again." : view.notice.state === "sending" ? "it is being sent." : "only the person who wrote it, or an admin, can change it."}</Notice><div className="mt-3"><LinkButton href={here} primary>Open the notice</LinkButton></div></>;
  }
  const review = view.review;
  return <Screen ctx={ctx} initial={initialOf(view)} title={view.can.edit ? "Edit notice" : "Correct notice"} back={{ href: here, label: view.notice.title }}
    banner={review ? <div className="pb-4"><Notice tone="warning">{review.kind === "rejected" ? "Rejected" : "Sent back with a note"}: {review.note}</Notice></div> : null} />;
}
