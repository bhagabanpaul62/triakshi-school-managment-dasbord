"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBan, IconCalendarPlus, IconPencil, IconSend, IconTrash } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { MenuItem, MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { toast } from "@smw/ui/shell/toast";
import type { Scope } from "../constants";
import { cancelEvent, deleteEvent, publishEvent } from "./actions";
import { ScopeChoice } from "./scope-choice";
import { PRIMARY } from "./styles";

export interface EventActionsProps { id: string; state: "draft" | "live" | "cancelled"; inSeries: boolean; canRun: boolean }

/** What the person who runs an event can do next, by its state. Everyone gets "Add to calendar". */
export function EventActions({ id, state, inSeries, canRun }: EventActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"cancel" | "delete" | "publish" | null>(null);
  const [scope, setScope] = useState<Scope>("this");
  const [reason, setReason] = useState("");
  const [tell, setTell] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, extra: Record<string, string>, done: string, to?: string) => start(async () => {
    const fd = new FormData();
    fd.set("id", id); fd.set("scope", scope);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const r = await action(fd);
    if (!r.ok) { setError(r.error ?? "Something went wrong."); return; }
    setDialog(null); setError(null); toast(done);
    if (to) router.push(to); else router.refresh();
  });
  const close = () => { setDialog(null); setError(null); };

  // One main step by state; everything else waits in "More". The calendar link is the main step for people who only watch.
  const open = (d: "cancel" | "delete" | "publish") => () => setDialog(d);
  const publish = <button key="publish" type="button" onClick={open("publish")} className={PRIMARY}><IconSend className="h-4 w-4" aria-hidden />Publish</button>;
  const editIcon = <IconPencil className="h-4 w-4" aria-hidden />;
  const calendarIcon = <IconCalendarPlus className="h-4 w-4" aria-hidden />;
  const editHref = `/app/events/${id}/edit`;
  const icsHref = `/api/calendar/events/${id}/event.ics`;
  const cancel = <MenuItem key="cancel" onClick={open("cancel")}><IconBan className="h-4 w-4" aria-hidden />Cancel event</MenuItem>;
  const del = <MenuItem key="delete" tone="danger" onClick={open("delete")}><IconTrash className="h-4 w-4" aria-hidden />Delete draft</MenuItem>;
  const runs = canRun && state !== "cancelled";
  const primary = state === "draft" ? (canRun ? publish : null) : runs ? <Link key="edit" href={editHref} className={PRIMARY}>{editIcon}Edit</Link> : <a key="ics" href={icsHref} className={PRIMARY}>{calendarIcon}Add to calendar</a>;
  const more = [
    ...(state === "draft" && runs ? [<MenuLink key="edit" href={editHref}>{editIcon}Edit</MenuLink>] : []),
    ...(state === "live" && runs ? [<MenuLink key="ics" href={icsHref}>{calendarIcon}Add to calendar</MenuLink>, cancel] : []),
    ...(state === "draft" && canRun ? [del] : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {more.length ? (
          <MoreMenu>{more}</MoreMenu>
        ) : null}
      </div>

      <Modal open={dialog === "cancel"} onOpenChange={(o) => !o && close()} size="sm" title="Cancel this event?" tone="danger"
        description="Everyone it was for is told, with your reason. It stays on the calendar, struck through."
        footer={<ModalFooter danger secondary={{ label: "Keep the event", onClick: close }} primary={{ label: "Cancel event", loading: pending, onClick: () => run(cancelEvent, { reason }, "Event cancelled. People have been told.") }} />}>
        <div className="flex flex-col gap-4 pt-2">
          <ModalField label="Why is it cancelled?" htmlFor="cancel-reason" required error={error}>
            <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="For example: heavy rain, the ground is not safe" className={`${INPUT} h-auto py-2`} />
          </ModalField>
          {inSeries ? <ScopeChoice value={scope} onChange={setScope} /> : null}
        </div>
      </Modal>

      <Modal open={dialog === "delete"} onOpenChange={(o) => !o && close()} size="sm" title="Delete this draft?" tone="danger" description="Nobody was told about it, so it can simply be removed. This cannot be undone."
        footer={<ModalFooter danger secondary={{ label: "Keep it", onClick: close }} primary={{ label: "Delete draft", loading: pending, onClick: () => run(deleteEvent, {}, "Draft deleted", "/app/events") }} />}>
        <div className="flex flex-col gap-3 pt-2">
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
          {inSeries ? <ScopeChoice value={scope} onChange={setScope} /> : null}
        </div>
      </Modal>

      <Modal open={dialog === "publish"} onOpenChange={(o) => !o && close()} size="sm" title="Publish this event?" description="It goes on the calendar of everyone it is for."
        footer={<ModalFooter secondary={{ label: "Not yet", onClick: close }} primary={{ label: "Publish", loading: pending, onClick: () => run(publishEvent, { notify: String(tell) }, "Published") }} />}>
        <div className="flex flex-col gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Tell them now (a message on their phone and in the app)</label>
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
