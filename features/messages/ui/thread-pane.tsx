"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArchive, IconBellOff, IconDownload, IconFlag, IconMailOpened, IconPin } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { ChatBubble } from "@smw/ui/comm/ChatBubble";
import { Composer } from "@smw/ui/comm/Composer";
import { ConversationLog, type LogItem } from "@smw/ui/comm/ConversationLog";
import { FOCUS, PILL_BTN } from "./styles";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { MAX_FILE_MB, MAX_FILES, REMOVE_MINUTES, REPORT_CATEGORIES, REVIEW_BANNER, ROLE_WORDS } from "../constants";
import { markThread, markUnread, moveToTeacher, removeMessage, reportConcern, sendMessage } from "./actions";
import { SavedReplyPicker, type ReplyOption } from "./saved-replies";
import { clock } from "@smw/feature-kit/words";

export interface PaneMessage {
  id: string; kind: "text" | "system" | "note"; sender: string; mine: boolean; body: string; at: string; deliverAfter: string | null; removed: boolean; removedByName: string | null;
  files: { id: string; name: string; size: number; type: string }[]; seen: { by: number; of: number; at: string | null } | null;
}
export interface PaneProps {
  id: string; subject: string; studentName: string | null; reviewBanner: boolean; firstWrite: boolean;
  people: { userId: string | null; name: string; role: string; mine: boolean }[];
  messages: PaneMessage[]; olderHref: string | null;
  block: { reason: string; action?: { label: string; href: string } } | null; notice: string | null;
  canFiles: boolean; replies: ReplyOption[];
  flags: { pinned: boolean; muted: boolean; archived: boolean };
  backHref: string;
  /** Teachers an admin may move a closed conversation to. Empty hides the form. */
  moveTo: { id: string; name: string }[];
  safetyContacts: { name: string; phone: string }[];
}

const SMALL = cn("rounded-full px-2 py-1 text-xs text-[var(--ds-on-surface-muted)] underline-offset-2 hover:text-[var(--ds-on-surface)] hover:underline", FOCUS);

export function ThreadPane(p: PaneProps) {
  const router = useRouter();
  const [flags, setFlags] = useState(p.flags);
  const [report, setReport] = useState<{ messageId?: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, run] = useTransition();

  // Paint first, save after, snap back with a message when the save fails.
  const toggle = (flag: keyof typeof flags) => {
    const was = flags[flag];
    setFlags((f) => ({ ...f, [flag]: !was }));
    run(async () => {
      const r = await markThread(p.id, flag === "pinned" ? "pinned" : flag === "muted" ? "muted" : "archived", !was);
      if (!r.ok) { setFlags((f) => ({ ...f, [flag]: was })); toast(r.error, "danger"); } else if (flag === "archived" && !was) { toast("Archived"); router.push(p.backHref); } else router.refresh();
    });
  };
  const unread = () => run(async () => { const r = await markUnread(p.id); if (r.ok) router.push(p.backHref); else toast(r.error, "danger"); });
  const remove = (id: string) => run(async () => { const r = await removeMessage(id); setConfirmId(null); if (r.ok) { toast("Message removed"); router.refresh(); } else toast(r.error, "danger"); });

  const newestMine = [...p.messages].reverse().find((m) => m.mine && m.kind === "text");
  const items: LogItem[] = p.messages.map((m) => {
    const young = m.mine && m.kind === "text" && !m.removed && Date.now() - new Date(m.at).getTime() < REMOVE_MINUTES * 60_000;
    const seenLine = m.id === newestMine?.id
      ? [m.deliverAfter ? `Will be delivered at ${clock(m.deliverAfter)}` : null, m.seen ? (m.seen.of === 1 ? (m.seen.by ? `Seen${m.seen.at ? ` ${clock(m.seen.at)}` : ""}` : "Delivered") : `Seen by ${m.seen.by} of ${m.seen.of}`) : "Delivered"].filter(Boolean).join(" · ")
      : undefined;
    return {
      id: m.id, at: m.at, mine: m.mine,
      node: (
        <div className="group flex flex-col">
          <ChatBubble kind={m.kind === "text" ? "message" : m.kind} mine={m.mine} sender={m.sender} at={m.at} text={m.body} removed={m.removed} removedBy={m.removedByName ?? undefined} seenLine={seenLine}
            files={m.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.type, href: `/api/messages/files/${f.id}` }))} />
          {m.kind === "text" && !m.removed ? (
            <div className={cn("flex gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100", m.mine && "justify-end")}>
              {young && confirmId !== m.id ? <button type="button" className={SMALL} onClick={() => setConfirmId(m.id)}>Remove</button> : null}
              {confirmId === m.id ? (
                <span role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[var(--ds-on-surface-variant)]">
                  Others will see “Message removed”. This cannot be undone.
                  <button type="button" className={SMALL} onClick={() => remove(m.id)}>Yes, remove</button>
                  <button type="button" className={SMALL} onClick={() => setConfirmId(null)}>Keep</button>
                </span>
              ) : null}
              {!m.mine ? <button type="button" className={SMALL} onClick={() => setReport({ messageId: m.id })}>Report</button> : null}
            </div>
          ) : null}
        </div>
      ),
    };
  });

  const others = p.people.filter((x) => !x.mine);
  const notice = [p.firstWrite && p.reviewBanner ? REVIEW_BANNER : null, p.notice].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={p.backHref} className={cn(PILL_BTN, "lg:hidden")}>Back</Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium text-[var(--ds-on-surface)]">{p.subject}</h2>
          <p className="truncate text-xs text-[var(--ds-on-surface-muted)]" title={others.map((x) => x.name).join(", ")}>
            {p.studentName ? `About ${p.studentName} · ` : ""}{others.map((x) => `${x.name} (${ROLE_WORDS[x.role] ?? x.role})`).join(", ") || "Only you"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="This conversation">
          <button type="button" aria-pressed={flags.pinned} onClick={() => toggle("pinned")} className={cn(PILL_BTN, "h-9 px-3", flags.pinned && "bg-white/[0.16]")}><IconPin className="h-4 w-4" aria-hidden />{flags.pinned ? "Pinned" : "Pin"}</button>
          <button type="button" aria-pressed={flags.muted} onClick={() => toggle("muted")} className={cn(PILL_BTN, "h-9 px-3", flags.muted && "bg-white/[0.16]")}><IconBellOff className="h-4 w-4" aria-hidden />{flags.muted ? "Muted" : "Mute"}</button>
          <button type="button" aria-pressed={flags.archived} onClick={() => toggle("archived")} className={cn(PILL_BTN, "h-9 px-3")}><IconArchive className="h-4 w-4" aria-hidden />{flags.archived ? "Unarchive" : "Archive"}</button>
          <button type="button" onClick={unread} className={cn(PILL_BTN, "h-9 px-3")}><IconMailOpened className="h-4 w-4" aria-hidden />Mark unread</button>
          <button type="button" onClick={() => setReport({})} className={cn(PILL_BTN, "h-9 px-3")}><IconFlag className="h-4 w-4" aria-hidden />Report a concern</button>
          <a href={`/api/messages/export/${p.id}`} className={cn(PILL_BTN, "h-9 px-3")}><IconDownload className="h-4 w-4" aria-hidden />PDF</a>
        </div>
      </div>

      {p.reviewBanner ? <p className="rounded-2xl bg-white/[0.04] px-4 py-2 text-xs text-[var(--ds-on-surface-variant)]">{REVIEW_BANNER}</p> : null}

      {p.moveTo.length ? <MoveForm threadId={p.id} teachers={p.moveTo} /> : null}

      <ConversationLog className="min-h-[40dvh] flex-1" label={`Messages in ${p.subject}`} items={items}
        loadOlder={p.olderHref ? <Link href={p.olderHref} className={PILL_BTN}>Earlier messages</Link> : undefined}
        empty={<p className="py-8 text-center text-sm text-[var(--ds-on-surface-muted)]">No messages yet. Write the first one below.</p>} />

      <Composer hidden={{ threadId: p.id }} disabled={p.block ?? undefined} notice={notice || undefined} maxLength={4000}
        send={async (fd) => { const r = await sendMessage(fd); if (r.ok) router.refresh(); return r.ok ? { ok: true } : { ok: false, error: r.error }; }}
        files={p.canFiles ? { accept: ["application/pdf", "image/*"], maxCount: MAX_FILES, maxMb: MAX_FILE_MB } : undefined}
        savedReplies={p.replies.length ? <SavedReplyPicker replies={p.replies} /> : undefined} />

      <ReportDialog open={!!report} onClose={() => setReport(null)} threadId={p.id} messageId={report?.messageId} people={others} contacts={p.safetyContacts} />
    </div>
  );
}

function MoveForm({ threadId, teachers }: { threadId: string; teachers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, run] = useTransition();
  return (
    <form onSubmit={keepValues((fd) => run(async () => { const r = await moveToTeacher(fd); if (r.ok) { toast("Moved to the new teacher"); router.push(`/app/messages?thread=${threadId}`); router.refresh(); } else toast(r.error, "danger"); }))}
      className="flex flex-wrap items-end gap-2 rounded-2xl bg-white/[0.04] p-3">
      <input type="hidden" name="threadId" value={threadId} />
      <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Move this conversation to
        <select name="teacherId" required className={cn(INPUT, "min-w-48")}>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <button type="submit" disabled={pending} className={PILL_BTN}>{pending ? "Moving…" : "Move and reopen"}</button>
    </form>
  );
}

function ReportDialog({ open, onClose, threadId, messageId, people, contacts }: { open: boolean; onClose: () => void; threadId: string; messageId?: string; people: { userId: string | null; name: string }[]; contacts: { name: string; phone: string }[] }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ told: number } | null>(null);
  const [pending, run] = useTransition();
  const id = "report-form";
  const close = () => { setDone(null); setErrors({}); onClose(); };

  const submit = (fd: FormData) => run(async () => {
    const r = await reportConcern(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return toast(r.error, "danger"); }
    setDone({ told: (r.data as { told: number }).told });
  });

  return (
    <Modal open={open} onOpenChange={(v) => { if (!v) close(); }} size="md" title="Report a concern"
      description={messageId ? "About this message. The school's safeguarding lead will look at it. The person it is about is not told." : "About this conversation. The school's safeguarding lead will look at it. The people it is about are not told."}
      footer={done ? <ModalFooter secondary={{ onClick: close, label: "Close" }} /> : <ModalFooter secondary={{ onClick: close }} primary={{ label: "Send report", type: "submit", form: id, loading: pending }} />}>
      {done ? (
        <ModalSection>
          <p className="text-sm text-[var(--ds-on-surface)]">{done.told ? "Thank you. The school's safeguarding lead has been told. You can follow it under Messages, My concerns." : "Your report is saved, but nobody at the school could be told right now."}</p>
          {!done.told && contacts.length ? (
            <ul className="mt-3 text-sm text-[var(--ds-on-surface-variant)]">{contacts.map((c) => <li key={c.phone}>{c.name}: <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a></li>)}</ul>
          ) : null}
        </ModalSection>
      ) : (
        <form id={id} onSubmit={keepValues(submit)} className="pt-2" noValidate>
          <input type="hidden" name="threadId" value={threadId} />
          {messageId ? <input type="hidden" name="messageId" value={messageId} /> : null}
          <ModalSection>
            <div className="flex flex-col gap-4">
              <ModalField label="What happened" htmlFor="report-cat" required error={errors.category}>
                <select id="report-cat" name="category" required defaultValue="" className={INPUT}>
                  <option value="" disabled>Choose one</option>
                  {Object.entries(REPORT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </ModalField>
              <ModalField label="Tell us more" htmlFor="report-note" required error={errors.note}>
                <textarea id="report-note" name="note" required rows={4} maxLength={1000} className={cn(INPUT, "h-auto py-2")} />
              </ModalField>
              {people.length > 1 || messageId ? (
                <ModalField label="Is it about someone else in this conversation?" htmlFor="report-about" error={errors.aboutUserId}>
                  <select id="report-about" name="aboutUserId" defaultValue="" className={INPUT}>
                    <option value="">No one else</option>
                    {people.filter((x) => x.userId).map((x) => <option key={x.userId} value={x.userId!}>{x.name}</option>)}
                  </select>
                </ModalField>
              ) : null}
            </div>
          </ModalSection>
        </form>
      )}
    </Modal>
  );
}
