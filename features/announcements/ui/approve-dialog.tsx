"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { PRIMARY_BTN } from "@smw/ui/finance/ui";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/tone";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { fromIstInput } from "@smw/feature-kit/words";
import { approveNotice } from "./actions";
import { diffLines, type DiffLine } from "./diff";
import { DiffView } from "./diff-view";

export interface ApproveDialogProps {
  id: string; title: string; body: string; audience: Audience; /** IST `datetime-local` text, "" when none. */ dueAt: string; asks: boolean;
  options: AudienceOptions; labels: Record<string, string>;
  /** What it said when it was last sent back, when it was. */
  earlier: { title: string; body: string } | null;
  /** The author is the only approver: a reason is kept on record. */
  needsReason: boolean;
}

/** The words as lines, with the title first, so one diff shows both. */
const lines = (title: string, body: string) => `Title: ${title}\n${body}`;
const Diff = ({ from, to }: { from: string; to: string }) => <DiffView lines={diffLines(from, to)} />;

/** Approve, optionally after editing the title, words, audience or last date. Shows what changed before the button is pressed. */
export function ApproveDialog({ id, title: t0, body: b0, audience: a0, dueAt: d0, asks, options, labels, earlier, needsReason }: ApproveDialogProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(t0), [body, setBody] = useState(b0), [audience, setAudience] = useState(a0), [dueAt, setDueAt] = useState(d0), [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const edits: Record<string, unknown> = {
    ...(title !== t0 ? { title } : {}), ...(body !== b0 ? { body } : {}),
    ...(JSON.stringify(audience) !== JSON.stringify(a0) ? { audience } : {}), ...(dueAt !== d0 ? { dueAt: fromIstInput(dueAt) } : {}),
  };
  const changed = Object.keys(edits).length > 0;
  const since: DiffLine[] | null = earlier ? diffLines(lines(earlier.title, earlier.body), lines(t0, b0)) : null;

  const run = () => start(async () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    if (changed) fd.set("payload", JSON.stringify(edits));
    if (reason) fd.set("reason", reason);
    const r = await approveNotice(fd).catch(() => null);
    if (!r) { setError("No connection. Nothing changed. Try again."); return; }
    if (!r.ok) { setError(r.fieldErrors ? Object.values(r.fieldErrors).join(" ") : r.error); return; }
    setOpen(false); toast(r.message ?? "Approved"); router.refresh();
  });

  return (
    <>
      <button type="button" className={PRIMARY_BTN} onClick={() => setOpen(true)}>Approve</button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Approve this notice" dismissOnOutsideClick={false}
        description="Read it, change what needs changing, and approve. The writer is told if you changed anything, and the wording they sent is kept in History."
        footer={<ModalFooter summary={changed ? "You changed it" : "No changes"} secondary={{ label: "Not now", onClick: () => setOpen(false) }} primary={{ label: changed ? "Approve with changes" : "Approve and send", onClick: run, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2">
          {since ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-[var(--ds-on-surface)]">Changed since you sent it back</p>
              {since.some((l) => l.kind !== "same") ? <DiffView lines={since} /> : <p className="text-sm text-[var(--ds-on-surface-muted)]">The writer sent it again without changing the words.</p>}
            </div>
          ) : null}
          <ModalField label="Title" htmlFor="ap-title"><input id="ap-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} className={INPUT} /></ModalField>
          <ModalField label="Message" htmlFor="ap-body"><textarea id="ap-body" value={body} rows={8} maxLength={10_000} onChange={(e) => setBody(e.target.value)} className={INPUT} /></ModalField>
          <ModalField label="Who it is for"><AudiencePicker name="audience" value={audience} onChange={setAudience} options={options} labels={labels} /></ModalField>
          {asks ? <ModalField label="Answer by" htmlFor="ap-due"><input id="ap-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT} /></ModalField> : null}
          {needsReason ? <ModalField label="Why you approve your own notice" htmlFor="ap-why" hint="No one else can approve notices here. This is kept on record."><textarea id="ap-why" value={reason} rows={2} maxLength={300} onChange={(e) => setReason(e.target.value)} className={INPUT} /></ModalField> : null}
          {changed ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-[var(--ds-on-surface)]">What you changed</p>
              {title !== t0 || body !== b0 ? <Diff from={lines(t0, b0)} to={lines(title, body)} /> : null}
              {"audience" in edits ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Who it is for was changed.</p> : null}
              {"dueAt" in edits ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Answer by: {d0 ? d0.replace("T", " ") : "none"} to {dueAt ? dueAt.replace("T", " ") : "none"}</p> : null}
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
