"use client";

import { useState } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { toast } from "@smw/ui/shell/toast";
import { EMAIL_MODES, type EmailMode } from "../constants";
import type { CommSettings } from "../settings";
import { TOPIC_GROUPS, type TopicGroup } from "../topics";
import { saveCommSettings } from "./comm-settings-actions";
import { plural } from "@smw/feature-kit/words";

const field = "h-10 rounded-xl bg-white/[0.06] px-3 text-sm text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
const soft = "text-[var(--ds-on-surface-muted)]";
const EMAIL_LABEL: Record<EmailMode, string> = { off: "Off", instant: "Instant", digest: "Daily summary" };
// Same padding the services use: circulars 3 digits, requests 4.
export const numberExample = (format: string, pad: number) => format.replace("{session}", "2026-27").replace("{n}", "42".padStart(pad, "0"));

type Saved = { ok: boolean; error?: string };

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="inline-flex h-10 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
      <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${on ? "bg-[var(--ds-color-primary-500)]" : "bg-white/[0.12]"}`}>
        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 flex-1 basis-56 text-sm text-[var(--ds-on-surface)]">{title}{hint ? <span className={`block text-xs ${soft}`}>{hint}</span> : null}</span>
      {children}
    </div>
  );
}

/** A text box that saves when you leave it and says what happened next to it. */
function TextSetting({ label, value, onSave, type = "text", example, hint, wide }: {
  label: string; value: string; onSave: (v: string) => Promise<Saved>; type?: "text" | "time"; example?: (v: string) => string; hint?: string; wide?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const commit = async () => {
    if (draft === value || state === "saving") return;
    setState("saving");
    const r = await onSave(draft);
    if (r.ok) setState("saved");
    else { setState(r.error ?? "Could not save."); toast(r.error ?? "Could not save. Try again.", "danger"); }
  };
  const bad = state !== "idle" && state !== "saving" && state !== "saved";
  return (
    <label className={`block text-xs ${soft} ${wide ? "w-full" : ""}`}>{label}
      <input type={type} className={`${field} mt-1 block ${wide ? "w-full" : ""}`} value={draft} aria-invalid={bad} onChange={(e) => { setDraft(e.target.value); setState("idle"); }} onBlur={commit} />
      {example ? <span className="mt-1 block">Example: <span className="text-[var(--ds-on-surface)]">{example(draft)}</span></span> : null}
      {hint ? <span className="mt-1 block">{hint}</span> : null}
      <span role="status" className={`mt-1 block min-h-4 ${bad ? "text-[var(--ds-color-danger-400,#f87171)]" : ""}`}>{state === "saving" ? "Saving..." : state === "saved" ? "Saved" : bad ? state : ""}</span>
    </label>
  );
}

/** Every switch paints first, saves after, and snaps back with a message when the save fails. */
export function CommSettingsForm({ initial }: { initial: CommSettings }) {
  const [s, setS] = useState(initial);
  const save = async (patch: Partial<CommSettings>): Promise<Saved> => {
    const r = await saveCommSettings(patch);
    if (r.ok) { setS(r.data); return { ok: true }; }
    return { ok: false, error: r.error };
  };
  /** Optimistic: show the change, revert and tell if the save is refused. */
  const set = async (patch: Partial<CommSettings>) => {
    const was = s;
    setS({ ...s, ...patch });
    const r = await saveCommSettings(patch);
    if (r.ok) setS(r.data);
    else { setS(was); toast(r.error ?? "Could not save. Try again.", "danger"); }
  };
  const approval = (k: keyof CommSettings["approvalFor"], v: boolean) => set({ approvalFor: { ...s.approvalFor, [k]: v } });

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel title="Quiet hours">
        <p className={`mb-2 text-sm ${soft}`}>Pushes and emails wait until the quiet hours end. Everything still shows in the app. Urgent alerts ignore quiet hours.</p>
        <div className="flex flex-wrap gap-4">
          <TextSetting label="From" type="time" value={s.quietFrom} onSave={(v) => save({ quietFrom: v })} />
          <TextSetting label="To" type="time" value={s.quietTo} onSave={(v) => save({ quietTo: v })} />
        </div>
        <Row title="Quiet all day on Sundays"><Switch on={s.quietSundays} label="Quiet all day on Sundays" onChange={(v) => set({ quietSundays: v })} /></Row>
      </Panel>

      <Panel title="Who may publish">
        <Row title="Teachers publish to their own sections" hint="Choose approval and an admin checks each notice first.">
          <SegmentedControl size="sm" label="Teacher publishing" options={[{ value: "free", label: "Freely" }, { value: "approval", label: "With approval" }]} value={s.teacherPublish} onChange={(v) => set({ teacherPublish: v as CommSettings["teacherPublish"] })} />
        </Row>
        <p className={`pt-2 text-xs ${soft}`}>Approval is needed before anyone but an admin sends a notice to:</p>
        <Row title="All families"><Switch on={s.approvalFor.families} label="Approval for all families" onChange={(v) => approval("families", v)} /></Row>
        <Row title="The whole school"><Switch on={s.approvalFor.wholeSchool} label="Approval for the whole school" onChange={(v) => approval("wholeSchool", v)} /></Row>
        <Row title="The public website"><Switch on={s.approvalFor.website} label="Approval for the public website" onChange={(v) => approval("website", v)} /></Row>
      </Panel>

      <Panel title="Messages">
        <Row title="Families may start a conversation"><Switch on={s.familiesMayStart} label="Families may start a conversation" onChange={(v) => set({ familiesMayStart: v })} /></Row>
        <Row title="Families may reply"><Switch on={s.familiesMayReply} label="Families may reply" onChange={(v) => set({ familiesMayReply: v })} /></Row>
        <Row title="Attachments in messages"><Switch on={s.attachments} label="Attachments in messages" onChange={(v) => set({ attachments: v })} /></Row>
        <Row title="A teacher may message" hint="Families of the students they teach, or only their own class.">
          <SegmentedControl size="sm" label="Who a teacher may message" options={[{ value: "taught", label: "Students taught" }, { value: "class_teacher", label: "Own class only" }]} value={s.teacherMessages} onChange={(v) => set({ teacherMessages: v as CommSettings["teacherMessages"] })} />
        </Row>
        <Row title="Show families when staff have seen their message"><Switch on={s.showStaffSeen} label="Show families when staff have seen their message" onChange={(v) => set({ showStaffSeen: v })} /></Row>
      </Panel>

      <Panel title="Numbers and names">
        <div className="flex flex-col gap-3">
          <TextSetting wide label="Circular number" value={s.circularFormat} onSave={(v) => save({ circularFormat: v })} example={(v) => numberExample(v, 3)} hint="Keep {n}. {session} is the school year." />
          <TextSetting wide label="Request number" value={s.requestFormat} onSave={(v) => save({ requestFormat: v })} example={(v) => numberExample(v, 4)} hint="Keep {n}. {session} is the school year." />
          <TextSetting wide label="Office name families see" value={s.officeName} onSave={(v) => save({ officeName: v })} />
          <TextSetting wide label="Other languages for notices" value={s.languages.join(", ")} hint="Separate with commas, for example Hindi, Bengali. Up to 10."
            onSave={(v) => save({ languages: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </div>
      </Panel>

      <Panel title="Default channels" className="lg:col-span-2">
        <p className={`mb-2 text-sm ${soft}`}>What reaches people on their phone and email until they choose for themselves. The app always shows everything. Safety and security messages are always sent.</p>
        <div className="-mx-2 overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm">
          <thead className={`text-xs ${soft}`}><tr><th className="px-2 pb-2 font-normal">Type</th><th className="px-2 pb-2 font-normal">Push</th><th className="px-2 pb-2 font-normal">Email</th></tr></thead>
          <tbody>
            {(Object.keys(TOPIC_GROUPS) as TopicGroup[]).filter((g) => g !== "urgent" && g !== "account").map((g) => {
              const v = s.channelDefaults[g] ?? { push: true, email: "digest" as EmailMode };
              const put = (next: { push: boolean; email: EmailMode }) => set({ channelDefaults: { ...s.channelDefaults, [g]: next } });
              return (
                <tr key={g}>
                  <td className="px-2 py-1.5 text-[var(--ds-on-surface)]">{TOPIC_GROUPS[g]}</td>
                  <td className="px-2"><Switch on={v.push} label={`Push for ${TOPIC_GROUPS[g]}`} onChange={(push) => put({ push, email: v.email })} /></td>
                  <td className="px-2"><SegmentedControl size="sm" label={`Email for ${TOPIC_GROUPS[g]}`} options={EMAIL_MODES.map((m) => ({ value: m, label: EMAIL_LABEL[m] }))} value={v.email} onChange={(email) => put({ push: v.push, email })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>

      <Panel title="Keeping messages">
        <Row title="Keep old conversations and notices for" hint="Reported conversations are never removed.">
          <SegmentedControl size="sm" label="Years to keep" options={[1, 2, 3, 5, 7].map((y) => ({ value: String(y), label: `${plural(y, "year")}` }))} value={String(s.retentionYears)} onChange={(v) => set({ retentionYears: Number(v) })} />
        </Row>
      </Panel>

      <Panel title="Outside safety contacts">
        <p className={`mb-2 text-sm ${soft}`}>Shown when a report cannot go to anyone at school, for example a child helpline or the police.</p>
        <TextSetting wide label="Names and numbers" value={s.safetyContacts.map((c) => `${c.name}: ${c.phone}`).join("; ")}
          hint="Write name: number and separate contacts with a semicolon, for example Childline: 1098; Police: 112."
          onSave={(v) => save({ safetyContacts: v.split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.lastIndexOf(":"); return { name: x.slice(0, i < 0 ? 0 : i).trim(), phone: x.slice(i + 1).trim() }; }) })} />
      </Panel>
    </div>
  );
}
