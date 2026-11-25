"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { askToPublish, cancelSchedule, publishNow, schedulePublish, sendBack, withdrawAsk } from "./site-actions";

export interface PublishProps {
  canPublish: boolean; canManage: boolean; first: boolean; changes: string[]; blockers: string[]; warnings: string[];
  scheduledFor: string | null; asked: { by: string | null; note: string | null; mine: boolean } | null;
  offline: boolean; hasChanges: boolean;
}

type Which = null | "publish" | "schedule" | "ask" | "back";
const M = "text-[var(--ds-on-surface-muted)]";

/** Publish, schedule, ask to publish, send back: the whole publishing step, with what it will change and what stops it. */
export function PublishPanel(p: PublishProps) {
  const [which, setWhich] = useState<Which>(null);
  const [note, setNote] = useState("");
  const [at, setAt] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = () => { setWhich(null); setError(null); };
  const done = (msg: string) => { toast(msg); close(); setNote(""); router.refresh(); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, msg: string) => start(async () => {
    const r = await fn();
    if (r.ok) done(r.message ?? msg); else setError(r.error ?? "Something went wrong.");
  });
  const fd = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
  const blocked = p.blockers.length > 0;
  const needsOk = p.warnings.length > 0 && !accept;

  const changesList = (
    <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 text-sm">
      <p className="font-medium">{p.first ? "Going live for the first time" : p.changes.length ? "What changes for visitors" : "Nothing has changed since the last publish"}</p>
      {p.changes.length ? <ul className={`mt-2 list-disc pl-5 ${M}`}>{p.changes.map((c) => <li key={c}>{c}</li>)}</ul> : null}
    </div>
  );
  const checks = (
    <>
      {p.blockers.length ? (
        <div role="alert" className="mb-4 rounded-2xl bg-[var(--ds-color-danger-500)]/10 p-4 text-sm text-[var(--ds-color-danger-300)]">
          <p className="font-medium">Fix this first</p>
          <ul className="mt-2 list-disc pl-5">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <Link href="/app/website/edit" className="mt-2 inline-block underline">Go to the editor</Link>
        </div>
      ) : null}
      {p.warnings.length ? (
        <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 text-sm">
          <p className="font-medium">Worth a look</p>
          <ul className={`mt-2 list-disc pl-5 ${M}`}>{p.warnings.map((b) => <li key={b}>{b}</li>)}</ul>
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />I have seen this. Go ahead.</label>
        </div>
      ) : null}
    </>
  );
  const err = error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {p.canPublish ? (
          <>
            <Button type="button" className="rounded-full" disabled={!p.hasChanges && !p.first} onClick={() => setWhich("publish")}>{p.first ? "Publish" : "Publish changes"}</Button>
            <Button type="button" variant="secondary" className="rounded-full" disabled={!p.hasChanges && !p.first} onClick={() => setWhich("schedule")}>Schedule</Button>
          </>
        ) : p.canManage ? (
          p.asked?.mine ? <Button type="button" variant="secondary" className="rounded-full" isLoading={pending} onClick={() => run(() => withdrawAsk(), "Request taken back")}>Take back my request</Button>
            : <Button type="button" className="rounded-full" disabled={!p.hasChanges} onClick={() => setWhich("ask")}>Ask to publish</Button>
        ) : null}
        {p.canPublish && p.asked ? <Button type="button" variant="secondary" className="rounded-full" onClick={() => setWhich("back")}>Send back</Button> : null}
        {p.scheduledFor && p.canPublish ? <Button type="button" variant="ghost" className="rounded-full" isLoading={pending} onClick={() => run(() => cancelSchedule(), "Schedule cancelled")}>Cancel schedule</Button> : null}
        <Button asChild variant="ghost" className="rounded-full"><a href="/?preview=1" target="_blank" rel="noopener">Preview draft</a></Button>
      </div>

      <Modal open={which === "publish"} onOpenChange={(o) => !o && close()} size="md" title={p.first ? "Publish your website?" : "Publish the changes?"}
        description={p.offline ? "The website is offline for visitors. Publishing keeps it offline until you bring it back under Settings." : "Visitors see this at once. Every version stays under Versions, so you can bring one back."}
        footer={<ModalFooter secondary={{ onClick: close }} primary={{ label: "Publish", loading: pending, disabled: blocked || needsOk, onClick: () => run(() => publishNow(fd({ note, accept: accept ? "1" : "" })), "Website published") }} />}>
        {changesList}{checks}
        <ModalField label="Note for the version list" htmlFor="pub-note" hint="Optional. Like: admissions open for 2027.">
          <input id="pub-note" className={INPUT} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </ModalField>
        {err}
      </Modal>

      <Modal open={which === "schedule"} onOpenChange={(o) => !o && close()} size="md" title="Publish at a set time"
        description="The draft is frozen as it is now. Edits after this wait for the next publish. You can cancel before the time."
        footer={<ModalFooter secondary={{ onClick: close }} primary={{ label: "Schedule", loading: pending, disabled: blocked || !at, onClick: () => run(() => schedulePublish(fd({ at })), "Scheduled") }} />}>
        {changesList}{blocked ? checks : null}
        <ModalField label="Go live at (India time)" htmlFor="pub-at" required>
          <input id="pub-at" type="datetime-local" className={INPUT} value={at} onChange={(e) => setAt(e.target.value)} />
        </ModalField>
        {err}
      </Modal>

      <Modal open={which === "ask"} onOpenChange={(o) => !o && close()} size="md" title="Ask to publish"
        description="You may edit but not publish. The people who can publish are asked, and you are told what they decide."
        footer={<ModalFooter secondary={{ onClick: close }} primary={{ label: "Send request", loading: pending, disabled: blocked, onClick: () => run(() => askToPublish(fd({ note })), "Asked") }} />}>
        {changesList}{blocked ? checks : null}
        <ModalField label="Note for them" htmlFor="ask-note" hint="What did you change and why?">
          <textarea id="ask-note" rows={3} maxLength={300} className={`${INPUT} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </ModalField>
        {err}
      </Modal>

      <Modal open={which === "back"} onOpenChange={(o) => !o && close()} size="md" title="Send back to the editor"
        description={`${p.asked?.by ?? "The editor"} asked you to publish. Say what to change; they read it in their notifications.`}
        footer={<ModalFooter secondary={{ onClick: close }} primary={{ label: "Send back", loading: pending, disabled: note.trim().length < 3, onClick: () => run(() => sendBack(fd({ reason: note })), "Sent back") }} />}>
        <ModalField label="What should change?" htmlFor="back-note" required>
          <textarea id="back-note" rows={3} maxLength={300} className={`${INPUT} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </ModalField>
        {err}
      </Modal>
    </>
  );
}
