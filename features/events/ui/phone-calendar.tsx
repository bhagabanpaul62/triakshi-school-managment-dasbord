"use client";

import { useState, useTransition } from "react";
import { IconCalendarShare, IconCopy, IconDownload } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/shell/FormModal";
import { cn } from "@smw/ui/utils";
import { makeCalendarLink, stopCalendarLink } from "./actions";
import { PILL, MUTED } from "./styles";

/**
 * "Connect your phone calendar": a secret link for Google, Apple or Outlook. The link is shown once, right after it is made (only a
 * hash is kept), so a lost link is replaced by making a new one, which ends the old one.
 */
export function PhoneCalendar({ active, lastUsed, publicFeed }: { active: boolean; lastUsed: string | null; publicFeed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [on, setOn] = useState(active);
  const [sure, setSure] = useState(false);
  const [pending, start] = useTransition();

  const make = () => start(async () => {
    const r = await makeCalendarLink();
    if (!r.ok) { toast(r.error, "danger"); return; }
    setLink(`${location.origin}${r.data.path}`); setOn(true); setSure(false);
  });
  const stop = () => start(async () => {
    const r = await stopCalendarLink();
    if (!r.ok) { toast(r.error, "danger"); return; }
    setLink(null); setOn(false); setSure(false); toast("Phone calendar link switched off");
  });
  const copy = async () => { try { await navigator.clipboard.writeText(link!); toast("Link copied"); } catch { toast("Could not copy. Select the link and copy it by hand.", "danger"); } };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={PILL}><IconCalendarShare className="h-4 w-4" aria-hidden />Phone calendar</button>
      <Modal open={open} onOpenChange={setOpen} size="md" title="Connect your phone calendar" description="See exams, holidays, homework and school events in Google Calendar, Apple Calendar or Outlook."
        footer={<ModalFooter secondary={{ label: "Close", onClick: () => setOpen(false) }} />}>
        <div className="flex flex-col gap-4 pt-2 text-sm text-[var(--ds-on-surface-variant)]">
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>{on ? (link ? "Copy your link below." : "Your link is on. To see it again, make a new one: the old one stops working.") : "Make your link."}</li>
            <li>In your calendar app, choose Add calendar, then From URL (Google) or Subscribe to calendar (Apple, Outlook).</li>
            <li>Paste the link. Do not share it: anyone with it can see your calendar.</li>
          </ol>
          {link ? (
            <div className="flex flex-col gap-2">
              <input readOnly value={link} aria-label="Your calendar link" onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "w-full font-mono text-xs")} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className={PILL}><IconCopy className="h-4 w-4" aria-hidden />Copy link</button>
                <a href={link.replace(/^https?:/, "webcal:")} className={PILL}>Open in my calendar app</a>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!on ? <button type="button" disabled={pending} onClick={make} className={PILL}>Make my link</button> : sure ? (
              <>
                <button type="button" disabled={pending} onClick={make} className={PILL}>Yes, make a new link</button>
                <button type="button" onClick={() => setSure(false)} className={PILL}>Keep the old one</button>
              </>
            ) : <button type="button" disabled={pending} onClick={() => setSure(true)} className={PILL}>Make a new link</button>}
            {on && !sure ? <button type="button" disabled={pending} onClick={stop} className={PILL}>Switch it off</button> : null}
          </div>
          {sure ? <p className={MUTED}>The old link stops working at once, on every phone that uses it.</p> : null}
          {on && lastUsed ? <p className={MUTED}>A phone last used your link on {lastUsed}.</p> : null}
          <p className={MUTED}>Phones decide when to look again. A change can take up to a day to show on your phone. Cancelled events show as cancelled.</p>
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            <a href="/api/calendar/academic.pdf" className={PILL}><IconDownload className="h-4 w-4" aria-hidden />Academic calendar (PDF)</a>
            {publicFeed ? <a href="/api/calendar/public.ics" className={PILL}>School website calendar file</a> : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
