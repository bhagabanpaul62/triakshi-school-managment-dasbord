"use client";

import { useState, useTransition } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { saveMyAway as saveAway, saveMyHours as saveQuietHours } from "./actions";
import { PILL_BTN, PRIMARY_BTN } from "./styles";

type Res = { ok: boolean; error?: string };
export interface HoursProps { school: { from: string; to: string }; from: string | null; to: string | null; awayUntil: string | null; awayText: string | null }

/** My quiet hours and my away message. Both are saved at once and shown to the people who write to me. */
export function HoursForm(p: HoursProps) {
  const [hours, setHours] = useState({ from: p.from ?? p.school.from, to: p.to ?? p.school.to, own: !!p.from });
  const [away, setAway] = useState({ until: p.awayUntil ?? "", text: p.awayText ?? "" });
  const [pending, run] = useTransition();
  const save = (paint: () => void, undo: () => void, call: () => Promise<Res>) => {
    paint();
    run(async () => { const r = await call(); if (!r.ok) { undo(); toast(r.error ?? "Could not save. Try again.", "danger"); } else toast("Saved"); });
  };
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <Panel title="My quiet hours">
        <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">{hours.own ? "Messages sent in these hours show in the app at once, but your phone and email wait until the end." : `You are using the school's hours (${p.school.from} to ${p.school.to}, and Sundays). Set your own below.`}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--ds-on-surface-muted)]">From<input type="time" className={`${INPUT} mt-1 block`} value={hours.from} onChange={(e) => setHours({ ...hours, from: e.target.value })} /></label>
          <label className="text-xs text-[var(--ds-on-surface-muted)]">To<input type="time" className={`${INPUT} mt-1 block`} value={hours.to} onChange={(e) => setHours({ ...hours, to: e.target.value })} /></label>
          <button type="button" className={PRIMARY_BTN} disabled={pending} onClick={() => { const was = hours; save(() => setHours({ ...hours, own: true }), () => setHours(was), () => saveQuietHours({ from: hours.from, to: hours.to })); }}>Save my hours</button>
          {hours.own ? <button type="button" className={PILL_BTN} disabled={pending} onClick={() => { const was = hours; save(() => setHours({ from: p.school.from, to: p.school.to, own: false }), () => setHours(was), () => saveQuietHours(null)); }}>Use school hours</button> : null}
        </div>
      </Panel>
      <Panel title="Away">
        <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">People who write to you see when you are back and your note. Nothing is held back; they can still send.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--ds-on-surface-muted)]">Back on<input type="date" className={`${INPUT} mt-1 block`} value={away.until} onChange={(e) => setAway({ ...away, until: e.target.value })} /></label>
          <label className="min-w-48 flex-1 text-xs text-[var(--ds-on-surface-muted)]">Note<input type="text" maxLength={200} className={`${INPUT} mt-1 block w-full`} value={away.text} onChange={(e) => setAway({ ...away, text: e.target.value })} placeholder="For anything urgent, call the office." /></label>
          <button type="button" className={PRIMARY_BTN} disabled={pending || !away.until} onClick={() => save(() => undefined, () => undefined, () => saveAway(away.until, away.text))}>Save</button>
          {away.until ? <button type="button" className={PILL_BTN} disabled={pending} onClick={() => { const was = away; save(() => setAway({ until: "", text: "" }), () => setAway(was), () => saveAway(null)); }}>I am back</button> : null}
        </div>
      </Panel>
    </div>
  );
}
