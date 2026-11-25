"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@smw/ui/kit/Modal";
import { ResponseFunnel } from "@smw/ui/comm/ResponseFunnel";
import { UndoBar } from "@smw/ui/comm/UndoBar";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { Column, FilterDef } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import type { ActionResult } from "@smw/runtime";
import type { Funnel } from "../report-service";
import type { ResponseSpec } from "../constants";
import { funnelNow, nudgeChosen, releaseNotice, undoNotice } from "./actions";
import { PaperForm } from "./answer-form";
import { funnelParts } from "./funnel";

type Action = (fd: FormData) => Promise<ActionResult<unknown>>;
/** What to say after an action whose answer carries numbers. */
const SAYS: Record<string, (d: Record<string, number>) => string> = {
  nudge: (d) => (d.sent ? `Reminded ${d.sent} ${d.sent === 1 ? "person" : "people"}${d.alreadyToday ? `. ${d.alreadyToday} were reminded in the last day, so they were left.` : ""}` : d.alreadyToday ? "Everyone who has not answered was already reminded in the last day." : "Everyone has answered."),
  resend: (d) => `Sent again to ${d.sent} ${d.sent === 1 ? "person" : "people"}${d.noLogin ? `. ${d.noLogin} have no login: use the sign sheet.` : ""}`,
};

export interface RunButtonProps {
  action: Action; values: Record<string, string>; label: string; primary?: boolean; says?: keyof typeof SAYS;
  /** After it works: stay and refresh, or open this address. */
  to?: string;
  /** A consequence in words; asks first. */
  confirm?: string;
}

/** One button for one action: paints a busy state, says what happened in words, refreshes the page. */
export function RunButton({ action, values, label, primary, says, to, confirm: ask }: RunButtonProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const run = () => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd).catch(() => null);
    setOpen(false);
    if (!r) { toast("No connection. Nothing changed. Try again.", "danger"); return; }
    if (!r.ok) { toast(r.error, "danger"); return; }
    toast(says ? SAYS[says]!(r.data as Record<string, number>) : r.message ?? "Done");
    if (to) router.push(typeof r.data === "object" && r.data && "id" in r.data ? to.replace("{id}", String((r.data as { id: string }).id)) : to); else router.refresh();
  });
  return (
    <>
      <button type="button" disabled={pending} onClick={() => (ask ? setOpen(true) : run())} className={primary ? PRIMARY_BTN : PILL_BTN}>{label}</button>
      {ask ? (
        <Modal open={open} onOpenChange={setOpen} size="sm" title={label} footer={<div className="flex justify-end gap-2 bg-white/[0.03] px-6 py-4"><button type="button" className={PILL_BTN} onClick={() => setOpen(false)}>Not now</button><button type="button" disabled={pending} className={PRIMARY_BTN} onClick={run}>{label}</button></div>}>
          <p className="pt-2 text-sm text-[var(--ds-on-surface-variant)]">{ask}</p>
        </Modal>
      ) : null}
    </>
  );
}

/** The hold before sending: undo, or send at once. Both ask the server, which has the last word. */
export function UndoSending({ id, until }: { id: string; until: string }) {
  const router = useRouter();
  const act = (action: Action, message: string) => async () => {
    const fd = new FormData(); fd.set("id", id);
    const r = await action(fd).catch(() => null);
    if (r?.ok) { toast(message); router.refresh(); } else toast(r && !r.ok ? r.error : "No connection. Try again.", "danger");
  };
  return <UndoBar until={until} onUndo={act(undoNotice, "Not sent. It is a draft again.")} onSendNow={act(releaseNotice, "Sent")} onExpire={() => router.refresh()} />;
}

/** The funnel for an alert, counted again every 10 seconds while the page is open and visible. */
export function LiveFunnel({ id, initial, asks, consent }: { id: string; initial: Funnel; asks: boolean; consent: boolean }) {
  const [f, setF] = useState(initial);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const fd = new FormData(); fd.set("id", id);
      const r = await funnelNow(fd).catch(() => null);
      if (r?.ok) setF(r.data);
    };
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [id]);
  return <ResponseFunnel parts={funnelParts(f, asks, consent)} progress={asks ? { done: f.answered, total: f.recipients } : undefined} />;
}

/** "Write down a paper answer" for one person. */
function PaperButton({ noticeId, recipientId, name, spec }: { noticeId: string; recipientId: string; name: string; spec: ResponseSpec }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={PILL_BTN} onClick={() => setOpen(true)}>Paper answer</button>
      <Modal open={open} onOpenChange={setOpen} size="md" title="Write down a paper answer" description={name} dismissOnOutsideClick={false}>
        <PaperForm noticeId={noticeId} recipientId={recipientId} spec={spec} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export interface PeopleTableProps {
  noticeId: string; spec: ResponseSpec; canNudge: boolean; columns: Column[]; filters: FilterDef[];
  rows: (Record<string, unknown> & { id: string; name: string; answered: boolean })[];
  total: number; page: number; pageCount: number; emptyText: { title: string; description: string };
}

/** The people of a notice: tick some and remind them, or write down a paper answer for one. */
export function PeopleTable({ noticeId, spec, canNudge, rows, ...table }: PeopleTableProps) {
  const router = useRouter();
  const asks = spec.kind !== "none";
  return (
    <SelectableTable {...table} rows={rows} noun="person" searchPlaceholder="Search by name" empty={table.emptyText}
      bulkActions={asks && canNudge ? [{ label: "Remind", run: async (ids) => {
        const fd = new FormData(); fd.set("id", noticeId); fd.set("ids", JSON.stringify(ids));
        const r = await nudgeChosen(fd).catch(() => null);
        if (r?.ok) { toast(SAYS.nudge!(r.data)); router.refresh(); } else toast(r && !r.ok ? r.error : "No connection. Nobody was reminded.", "danger");
      } }] : []}
      rowActions={asks ? Object.fromEntries(rows.map((r) => [r.id, <PaperButton key={r.id} noticeId={noticeId} recipientId={r.id} name={r.name} spec={spec} />])) : undefined} />
  );
}
