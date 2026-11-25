import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { EmptyLine } from "@smw/ui/finance/States";
import { FileList } from "@smw/ui/comm/FileList";
import { ResponseFunnel } from "@smw/ui/comm/ResponseFunnel";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { StateChip } from "@smw/ui/comm/StateChip";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { dateTime } from "@smw/ui/format";
import { AudienceService } from "@smw/feature-notifications/audience";
import { toIstInput } from "@smw/feature-kit/words";
import type { Tone } from "@smw/ui/tone";
import { RESPONSE_WORDS, stop } from "../content";
import { changedSettings } from "../what-changed";
import { NoticeService, type NoticeView } from "../service";
import { askChanges, deleteDraft, duplicateNotice, recallNotice, rejectNotice, saveAsTemplate, sendScheduledNow, unscheduleNotice, withdrawNotice } from "./actions";
import { NoticeCard } from "./card";
import { ApproveDialog } from "./approve-dialog";
import { diffLines } from "./diff";
import { DiffView } from "./diff-view";
import { FamilyRecord } from "./family-record";
import { MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { RunButton, UndoSending } from "./notice-actions";
import { Responses } from "./responses-tab";
import { BackLink, HOME, LinkButton, Notice, one, RelatedLinks, STATE_KEY, TYPE_LABEL, type Query, type Related } from "./shared";

const SENT = ["sending", "published", "expired", "withdrawn"];
const text = (name: string, label: string, extra: object = {}) => ({ name, label, type: "textarea" as const, required: true, wide: true, ...extra });

/** The next steps for this notice in this state, as the buttons the person can really use. Nothing here ends in a refusal. */
function Steps({ v, canTemplate, approve }: { v: NoticeView; canTemplate: boolean; approve: ReactNode }) {
  const n = v.notice, id = n.id, c = v.can, own = `${HOME}/${id}`;
  const quiet = { variant: "secondary" as const, plus: false };
  const menu = { variant: "ghost" as const, plus: false };
  // The rare steps. The page keeps one main button.
  const more = [
    c.correct ? <MenuLink key="correct" href={`${own}/edit`}>Correct</MenuLink> : null,
    c.withdraw ? <FormModal key="withdraw" title="Withdraw this notice" description="People see the title struck through, Withdrawn by the school, and your reason. The words of the notice are hidden from them. A circular keeps its number in the register." icon="megaphone" fields={[text("reason", "Why it is withdrawn, as people will read it")]} hidden={{ id }} action={withdrawNotice} submitLabel="Withdraw" trigger={{ label: "Withdraw", ...menu }} summary="You can copy it to a new notice afterwards." /> : null,
    c.duplicate ? <RunButton key="duplicate" action={duplicateNotice} values={{ id }} label="Duplicate" to={`${HOME}/{id}/edit`} /> : null,
    canTemplate && SENT.includes(n.state) ? <FormModal key="template" title="Save as a template" icon="megaphone" fields={[{ name: "name", label: "Template name", required: true, wide: true }]} hidden={{ id }} action={saveAsTemplate} submitLabel="Save" trigger={{ label: "Save as template", ...menu }} /> : null,
    c.delete ? <ActionButton key="delete" variant="ghost" label="Delete draft" action={deleteDraft} values={{ id }} redirectTo={HOME} confirm={{ title: "Delete this draft?", body: `"${n.title || "This draft"}" and its files are deleted. This cannot be undone.`, confirmLabel: "Delete", danger: true }} /> : null,
  ].filter(Boolean);
  return (
    <>
      {c.edit ? <LinkButton href={`${own}/edit`} primary>{v.review ? "Edit and send again" : "Keep writing"}</LinkButton> : null}
      {approve}
      {c.askChanges ? <FormModal title="Ask for changes" description="The author gets your note and the notice goes back to their drafts." icon="megaphone" fields={[text("note", "What should change")]} hidden={{ id }} action={askChanges} submitLabel="Send back" trigger={{ label: "Ask for changes", ...quiet }} /> : null}
      {c.reject ? <FormModal title="Reject this notice" description="The author is told why. It goes back to their drafts." icon="megaphone" fields={[text("reason", "Why")]} hidden={{ id }} action={rejectNotice} submitLabel="Reject" trigger={{ label: "Reject", ...quiet }} /> : null}
      {c.recall ? <RunButton action={recallNotice} values={{ id }} label="Take it back" /> : null}
      {c.sendNow ? <RunButton action={sendScheduledNow} values={{ id }} label="Send now" primary confirm="It goes to everyone it is for right now, ahead of its time." /> : null}
      {c.unschedule ? <RunButton action={unscheduleNotice} values={{ id }} label="Take off the schedule" /> : null}
      {c.report && n.state === "published" && n.response.kind !== "none" ? <LinkButton href={`${own}?tab=responses`} primary>Who has answered</LinkButton> : null}
      {n.type === "circular" && n.number && SENT.includes(n.state) ? <LinkButton href={`/api/notices/${id}/circular`}>PDF</LinkButton> : null}
      {more.length ? <MoreMenu>{more}</MoreMenu> : null}
    </>
  );
}

/** One line of what is happening now, with who it waits for. */
function Banner({ v }: { v: NoticeView }) {
  const n = v.notice;
  if (v.review && n.state === "draft") return <Notice tone="warning">{v.review.kind === "rejected" ? "Rejected" : "Sent back with a note"}: {v.review.note}</Notice>;
  if (n.state === "waiting") return <Notice tone="warning">{v.approvers.length ? `Waiting for ${v.approvers.join(" or ")} to approve it. ${v.approvers.join(" and ")} ${v.approvers.length === 1 ? "has" : "have"} been told in the app and by the daily summary.` : "No one else is set up to approve notices. Ask the school admin to add an approver."} {v.can.recall ? "You can take it back to change it." : ""}</Notice>;
  if (n.state === "scheduled" && n.scheduledAt) return <Notice tone="info">Goes out {dateTime(n.scheduledAt)}.</Notice>;
  if (n.state === "sending") return <Notice tone="info">{v.can.undo ? "Sending in a moment. You can undo until the bar below runs out." : "It is on its way to people now."}</Notice>;
  if (n.state === "withdrawn") return <Notice tone="warning">Withdrawn {dateTime(n.withdrawnAt)}: {stop(n.withdrawReason ?? "")} People see the title struck through, Withdrawn by the school, and your reason.</Notice>;
  if (n.state === "expired") return <Notice>This notice ended and is in the archive. It no longer asks for answers.</Notice>;
  return null;
}

function Changes({ v }: { v: NoticeView }) {
  if (!v.versions.length) return <EmptyLine title="No earlier versions." hint="When the notice is corrected, or an approver changes it, the older wording is kept here." />;
  const now = { title: v.notice.title, body: v.notice.body };
  return (
    <ol className="flex flex-col gap-3">
      {v.versions.map((ver, i) => {
        const newer = i === 0 ? now : (v.versions[i - 1]!.snapshot as { title?: string; body?: string });
        const old = ver.snapshot as { title?: string; body?: string };
        const lines = [...(old.title !== newer.title ? [{ kind: "removed" as const, text: `Title: ${old.title ?? ""}` }, { kind: "added" as const, text: `Title: ${newer.title ?? ""}` }] : []), ...diffLines(String(old.body ?? ""), String(newer.body ?? ""))];
        return (
          <li key={ver.version} className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4">
            <p className="text-sm font-medium text-[var(--ds-on-surface)]">Version {ver.version}{ver.note ? `: ${ver.note}` : ""}</p>
            <p className="text-xs text-[var(--ds-on-surface-muted)]">Replaced {dateTime(ver.at)}{ver.changedByName ? ` by ${ver.changedByName}` : ""}. Red was in this version, green is what came after.</p>
            <DiffView lines={lines} />
          </li>
        );
      })}
    </ol>
  );
}

/** /app/announcements/[id] for staff: the state and its next step, the notice as families see it, the report, the history. */
export async function StaffRecord({ ctx, id, sp, related = [] }: { ctx: Ctx; id: string; sp: Query; related?: Related[] }) {
  const svc = new NoticeService(ctx);
  let v: NoticeView;
  try { v = await svc.get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const n = v.notice, c = v.can;
  if (SENT.includes(n.state) && !c.report) {
    // A staff reader of a sent notice sees what its recipients see, and the earlier wordings under it (never a family: this page is staff only).
    return <><FamilyRecord ctx={ctx} id={id} lang={one(sp.lang)} related={related} />{v.versions.length ? <div className="max-w-3xl pt-4"><Panel title="Earlier versions"><Changes v={v} /></Panel></div> : null}</>;
  }
  const approve = c.approve ? <ApproveDialog id={id} title={n.title} body={n.body} audience={n.audience} dueAt={toIstInput(n.dueAt)} asks={n.response.kind !== "none"}
    options={await new AudienceService(ctx).options()} labels={await svc.labelsFor(n.audience)} earlier={v.versions[0] ? { title: String(v.versions[0].snapshot.title ?? ""), body: String(v.versions[0].snapshot.body ?? "") } : null} needsReason={c.approveNeedsReason} /> : null;
  const asks = n.response.kind !== "none";
  const s = v.stats;
  // The tab and the "How it is going" panel read the same `v.stats`, so they cannot disagree.
  const tabs = [{ key: "overview", label: "The notice" }, ...(c.report ? [asks ? { key: "responses", label: "Responses", count: s?.answered } : { key: "responses", label: s ? `Opened ${s.seen} of ${s.recipients}` : "Who has read it" }] : []), ...(v.versions.length ? [{ key: "history", label: "History", count: v.versions.length }] : [])];
  const tab = tabs.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : "overview";
  // After a send-back the approver sees what changed since they last looked: the words in the diff, the other settings by name.
  const last = v.versions[0];
  const sinceLooked = last?.note?.startsWith("As it was when") ? { settings: changedSettings(last.snapshot, n as unknown as Record<string, unknown>) } : null;
  return (
    <>
      <BackLink href={HOME}>Notices</BackLink>
      <PageHeader eyebrow={TYPE_LABEL[n.type]} title={n.title || "Untitled draft"}
        description={<span className="flex flex-wrap items-center gap-2">
          <StateChip kind="notice" state={STATE_KEY[n.state]} />
          {v.category ? <ToneBadge label={v.category.name} tone={v.category.tone as Tone} /> : null}
          {n.number ? <CopyValue value={n.number} label="circular number" /> : n.type === "circular" ? <span className="text-xs">Number given when it goes out</span> : null}
          {n.correctedAt ? <span className="text-xs">Updated {dateTime(n.correctedAt)}</span> : null}
        </span>}
        actions={ctx.readOnly ? null : <Steps v={v} canTemplate={svc.can("manage")} approve={approve} />} />
      {ctx.readOnly ? <div className="pb-4"><Notice tone="warning">This school is in read only mode. You can read this, but nothing can be sent or changed until the school is open again.</Notice></div> : null}
      <div className="flex flex-col gap-4">
        <Banner v={v} />
        <RelatedLinks related={related} />
        <SavedViews views={tabs} active={tab} basePath={`${HOME}/${id}`} param="tab" label="This notice" />
        {tab === "responses" ? <Responses ctx={ctx} v={v} sp={sp} /> : tab === "history" ? <Panel title="Earlier versions"><Changes v={v} /></Panel> : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-4">
              {n.state === "waiting" && sinceLooked ? (
                <Panel title="What changed since the approver last looked">
                  {sinceLooked.settings.length ? <p className="mb-3 text-sm text-[var(--ds-on-surface)]">Also changed: {sinceLooked.settings.join(", ")}. See the details on the right.</p> : null}
                  <Changes v={{ ...v, versions: v.versions.slice(0, 1) }} />
                </Panel>
              ) : null}
              <Panel title="How families read it">
                <div className="flex flex-col gap-3">
                  <NoticeCard type={n.type} number={n.number} category={v.category} title={n.title} body={n.body} response={n.response} dueAt={n.dueAt} updatedAt={n.correctedAt} />
                  {n.lang2 && n.title2 && n.body2 ? <NoticeCard type={n.type} category={v.category} title={n.title2} body={n.body2} /> : null}
                  <FileList files={v.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.contentType, href: `/api/notices/files/${f.id}` }))} />
                </div>
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {s && c.report ? (
                <Panel title="How it is going" action={c.report ? <LinkButton href={`${HOME}/${id}?tab=responses`}>Open</LinkButton> : undefined}>
                  <ResponseFunnel parts={asks ? [{ label: "Answered", value: s.answered, tone: "success" }, { label: "Not answered", value: Math.max(0, s.recipients - s.answered) }] : [{ label: "Opened", value: s.seen, tone: "success" }, { label: "Not opened", value: Math.max(0, s.recipients - s.seen) }]}
                    progress={asks ? { done: s.answered, total: s.recipients } : { done: s.seen, total: s.recipients, verb: "opened" }} />
                </Panel>
              ) : null}
              {v.preview && (n.state === "draft" || n.state === "waiting" || n.state === "scheduled") ? (
                <Panel title="Who it reaches">
                  <p className="text-sm text-[var(--ds-on-surface)]">{v.preview.total ? `${[v.preview.families ? `${v.preview.families} families` : "", v.preview.staff ? `${v.preview.staff} staff` : ""].filter(Boolean).join(" and ")}` : "Nobody yet"}</p>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{v.audienceText}</p>
                  {v.preview.unreachable.length ? <p className="mt-2 text-xs text-[var(--ds-color-warning-400)]">{v.preview.unreachable.length}{v.preview.unreachable.length === 100 ? "+" : ""} people have no phone alerts and no email. They will see it when they open the app: {v.preview.unreachable.slice(0, 3).map((u) => `${u.name} (${u.why})`).join("; ")}.</p> : null}
                </Panel>
              ) : null}
              <Panel title="Details">
                <FactList>
                  <Fact label="Written by">{v.authorName}</Fact>
                  <Fact label="For">{v.audienceText}</Fact>
                  <Fact label="Asks">{asks ? RESPONSE_WORDS[n.response.kind] : "Nothing"}</Fact>
                  <Fact label="Answer by">{n.dueAt ? dateTime(n.dueAt) : null}</Fact>
                  <Fact label="Sent">{n.publishedAt ? dateTime(n.publishedAt) : null}</Fact>
                  <Fact label="Pinned until">{n.pinnedUntil && n.pinnedUntil > new Date() ? dateTime(n.pinnedUntil) : null}</Fact>
                  <Fact label="Ends on">{n.expiresAt ? dateTime(n.expiresAt) : null}</Fact>
                  <Fact label="Website">{n.website ? "On the school website" : "App only"}</Fact>
                  <Fact label="Approved by">{v.approvedByName}</Fact>
                  <Fact label="Version">{n.version}</Fact>
                </FactList>
              </Panel>
            </div>
          </div>
        )}
      </div>
      {n.state === "sending" && c.undo && n.sendAt ? <UndoSending id={id} until={n.sendAt.toISOString()} /> : null}
    </>
  );
}
