"use client";

import { useState, useTransition } from "react";
import { IconLock } from "@tabler/icons-react";
import { Panel } from "@smw/ui/kit/Panel";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { toast } from "@smw/ui/shell/toast";
import { dateTime } from "@smw/ui/format";
import type { MyPrefs } from "../prefs";
import { EMAIL_MODES, type EmailMode } from "../constants";
import { TOPICS, TOPIC_GROUPS, type TopicGroup } from "../topics";
import { PushButton } from "./push-button";
import { removeDevice, saveAway, saveDigestHour, saveGroupPref, saveLanguage, saveQuietHours } from "./prefs-actions";

export interface DeviceRow { id: string; device: string | null; createdAt: string; lastOkAt: string | null }
type Result = { ok: boolean; error?: string };
type Groups = MyPrefs["groups"];

const EMAIL_LABEL: Record<EmailMode, string> = { off: "Off", instant: "Instant", digest: "Daily summary" };
const LANGUAGES = [["", "School default"], ["en", "English"], ["hi", "Hindi"], ["bn", "Bengali"]] as const;
const field = "h-10 rounded-xl bg-white/[0.06] px-3 text-sm text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
const button = "inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.1] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

const lockedWhy = (g: TopicGroup) => (g === "urgent" ? "Safety messages are always sent." : "Security messages are always sent.");
const partlyLocked = (g: TopicGroup) => Object.values(TOPICS).some((t) => t.group === g && "mustTell" in t);

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="inline-flex h-10 w-14 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-60">
      <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${on ? "bg-[var(--ds-color-primary-500)]" : "bg-white/[0.12]"}`}>
        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

/** Settings of one person. Every control paints first, saves after, and snaps back with a message when the save fails. */
export function PreferencesPanel({ prefs, devices: initialDevices }: { prefs: MyPrefs; devices: DeviceRow[] }) {
  const [groups, setGroups] = useState<Groups>(prefs.groups);
  const [digest, setDigest] = useState<8 | 18>(prefs.digestHour);
  const [language, setLanguage] = useState(prefs.language ?? "");
  const [quiet, setQuiet] = useState({ from: prefs.quietFrom ?? "20:00", to: prefs.quietTo ?? "07:00", custom: !!prefs.quietFrom });
  const [away, setAway] = useState({ until: prefs.awayUntil ?? "", text: prefs.awayText ?? "" });
  const [devices, setDevices] = useState(initialDevices);
  const [busy, start] = useTransition();

  const save = (paint: () => void, undo: () => void, call: () => Promise<Result>) => {
    paint();
    start(async () => { const r = await call(); if (!r.ok) { undo(); toast(r.error ?? "Could not save. Try again.", "danger"); } });
  };
  const setGroup = (g: TopicGroup, next: { push: boolean; email: EmailMode }) => {
    const was = groups[g];
    save(() => setGroups((x) => ({ ...x, [g]: { ...x[g], ...next, own: true } })), () => setGroups((x) => ({ ...x, [g]: was })), () => saveGroupPref({ group: g, ...next }));
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel title="What reaches you" action={<PushButton />}>
        <div className="-mx-2 overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="px-2 pb-2 font-normal">Type</th><th className="px-2 pb-2 font-normal">App</th><th className="px-2 pb-2 font-normal">Push</th><th className="px-2 pb-2 font-normal">Email</th></tr></thead>
          <tbody>
            {(Object.keys(TOPIC_GROUPS) as TopicGroup[]).map((g) => {
              const v = groups[g];
              return (
                <tr key={g} className="align-middle">
                  <td className="px-2 py-1.5 text-[var(--ds-on-surface)]">
                    <span className="flex items-center gap-2">{v.locked ? <IconLock className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /> : null}{TOPIC_GROUPS[g]}</span>
                    {v.locked ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{lockedWhy(g)}</span>
                      : partlyLocked(g) ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">Absence alerts are always sent.</span> : null}
                  </td>
                  <td className="px-2 text-[var(--ds-on-surface-muted)]">Always</td>
                  <td className="px-2"><Switch on={v.push} disabled={v.locked} label={`Push for ${TOPIC_GROUPS[g]}`} onChange={(push) => setGroup(g, { push, email: v.email })} /></td>
                  <td className="px-2">
                    {v.locked ? <span className="text-[var(--ds-on-surface-muted)]">{EMAIL_LABEL[v.email]}</span>
                      : <SegmentedControl size="sm" label={`Email for ${TOPIC_GROUPS[g]}`} options={EMAIL_MODES.map((m) => ({ value: m, label: EMAIL_LABEL[m] }))} value={v.email} onChange={(email) => setGroup(g, { push: v.push, email })} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Daily summary and language">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-[var(--ds-on-surface)]">Send my summary at</span>
              <SegmentedControl size="sm" label="Summary time" options={[{ value: "8", label: "8 am" }, { value: "18", label: "6 pm" }]} value={String(digest)}
                onChange={(v) => { const was = digest; const h = Number(v) as 8 | 18; save(() => setDigest(h), () => setDigest(was), () => saveDigestHour(h)); }} />
            </div>
            <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ds-on-surface)]">Language of messages
              <select className={field} value={language} onChange={(e) => { const was = language; const v = e.target.value; save(() => setLanguage(v), () => setLanguage(was), () => saveLanguage(v || null)); }}>
                {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </Panel>

        <Panel title="Quiet hours">
          <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">{quiet.custom ? "No pushes or emails in these hours, except urgent ones." : "Using your school's quiet hours. Set your own below."}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--ds-on-surface-muted)]">From<input type="time" className={`${field} mt-1 block`} value={quiet.from} onChange={(e) => setQuiet({ ...quiet, from: e.target.value })} /></label>
            <label className="text-xs text-[var(--ds-on-surface-muted)]">To<input type="time" className={`${field} mt-1 block`} value={quiet.to} onChange={(e) => setQuiet({ ...quiet, to: e.target.value })} /></label>
            <button type="button" className={button} disabled={busy} onClick={() => { const was = quiet; save(() => setQuiet({ ...quiet, custom: true }), () => setQuiet(was), () => saveQuietHours({ from: quiet.from, to: quiet.to })); }}>Save</button>
            {quiet.custom ? <button type="button" className={button} disabled={busy} onClick={() => { const was = quiet; save(() => setQuiet({ from: "20:00", to: "07:00", custom: false }), () => setQuiet(was), () => saveQuietHours(null)); }}>Use school hours</button> : null}
          </div>
        </Panel>

        <Panel title="Away">
          <p className="mb-3 text-sm text-[var(--ds-on-surface-muted)]">Pushes and emails wait until you are back. They are still in the app.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--ds-on-surface-muted)]">Back on<input type="date" className={`${field} mt-1 block`} value={away.until} onChange={(e) => setAway({ ...away, until: e.target.value })} /></label>
            <label className="min-w-40 flex-1 text-xs text-[var(--ds-on-surface-muted)]">Message<input type="text" maxLength={200} className={`${field} mt-1 block w-full`} value={away.text} onChange={(e) => setAway({ ...away, text: e.target.value })} /></label>
            <button type="button" className={button} disabled={busy || !away.until} onClick={() => save(() => undefined, () => undefined, () => saveAway(away.until, away.text))}>Save</button>
            {away.until ? <button type="button" className={button} disabled={busy} onClick={() => { const was = away; save(() => setAway({ until: "", text: "" }), () => setAway(was), () => saveAway(null)); }}>I am back</button> : null}
          </div>
        </Panel>

        <Panel title="Devices with push on">
          {devices.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">None yet. Use the button at the top to turn push on for this device.</p> : (
            <ul>{devices.map((d) => (
              <li key={d.id} className="flex min-h-12 items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-[var(--ds-on-surface)]"><span className="block truncate">{d.device ?? "Unnamed device"}</span><span className="text-xs text-[var(--ds-on-surface-muted)]">Added {dateTime(d.createdAt)}</span></span>
                <button type="button" className={button} disabled={busy} onClick={() => { const was = devices; save(() => setDevices((x) => x.filter((y) => y.id !== d.id)), () => setDevices(was), () => removeDevice(d.id)); }}>Remove</button>
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
