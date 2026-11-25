"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { previewBatch, sendBatch } from "./actions";
import { PILL_BTN, PRIMARY_BTN } from "./styles";
import type { BatchPreview } from "../batch";
import { plural } from "@smw/feature-kit/words";

const STEPS = ["Who", "What", "Check"] as const;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const RULES = ["section", "class", "subject", "student", "group", "house", "route", "stop"] as const;

/** Three steps: who gets it, what it says, and a last look at the count before sending. Each family gets a private conversation. */
export function FamiliesFlow({ options }: { options: AudienceOptions }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState<Audience>({ include: options.classTeacherSections.map((id) => ({ type: "section" as const, id })), exclude: [] });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(newId);
  const [pending, run] = useTransition();

  const form = () => { const f = new FormData(); f.set("audience", JSON.stringify(audience)); return f; };
  const check = () => run(async () => {
    setError(null);
    const r = await previewBatch(form());
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
    setStep(2);
  });
  const send = () => run(async () => {
    const f = form();
    f.set("subject", subject); f.set("body", body); f.set("clientId", clientId);
    const r = await sendBatch(f);
    if (!r.ok) { setError(r.error); return toast(r.error, "danger"); }
    toast(`Sent to ${plural(r.data.threads, "family", "families")}`);
    router.push(`/app/messages/families/${r.data.batchId}`);
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <ol className="flex gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex h-9 flex-1 items-center justify-center rounded-full text-sm", i === step ? "bg-white/[0.12] font-medium text-[var(--ds-on-surface)]" : i < step ? "bg-white/[0.06] text-[var(--ds-on-surface-variant)]" : "bg-white/[0.04] text-[var(--ds-on-surface-muted)]")}>{i + 1}. {s}</li>
        ))}
      </ol>
      <Panel>
        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">Choose a section, a subject group or chosen students. Each family gets its own private conversation; families never see each other.</p>
            <AudiencePicker name="audience" value={audience} onChange={setAudience} options={options} allow={[...RULES]} />
          </div>
        ) : null}
        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <label className="text-sm text-[var(--ds-on-surface-variant)]">Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className={cn(INPUT, "mt-1")} />
            </label>
            <label className="text-sm text-[var(--ds-on-surface-variant)]">Message
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={4000} className={cn(INPUT, "mt-1 h-auto py-2")} />
            </label>
          </div>
        ) : null}
        {step === 2 && preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-[28px] font-light tabular-nums text-[var(--ds-on-surface)]">{preview.families} {preview.families === 1 ? "family" : "families"}</p>
            <p className="text-sm text-[var(--ds-on-surface-variant)]">{preview.text}. Each gets a private conversation titled “{subject}”, and answers come back to you one by one.</p>
            {preview.sample.length ? <p className="text-xs text-[var(--ds-on-surface-muted)]">For example: {preview.sample.join(", ")}</p> : null}
            {preview.withoutLogin ? (
              <details className="rounded-2xl bg-white/[0.04] p-3 text-sm">
                <summary className="cursor-pointer">{preview.withoutLogin} {preview.withoutLogin === 1 ? "student has" : "students have"} no login and will not get it</summary>
                <ul className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{preview.unreachable.map((u) => <li key={u.name + u.label}>{u.name}, {u.label}: {u.why}</li>)}</ul>
              </details>
            ) : null}
            <blockquote className="whitespace-pre-wrap rounded-2xl bg-white/[0.05] p-3 text-sm">{body}</blockquote>
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      </Panel>
      <div className="flex items-center justify-between gap-2">
        {step === 0 ? <Link href="/app/messages" className={PILL_BTN}>Cancel</Link> : <button type="button" className={PILL_BTN} onClick={() => { setError(null); setStep(step - 1); }}>Back</button>}
        {step === 0 ? <button type="button" className={PRIMARY_BTN} disabled={!audience.include.length || pending} onClick={() => { setError(null); setStep(1); }}>Next: what to say</button> : null}
        {step === 1 ? <button type="button" className={PRIMARY_BTN} disabled={subject.trim().length < 2 || !body.trim() || pending} onClick={check}>{pending ? "Checking…" : "Next: check"}</button> : null}
        {step === 2 ? <button type="button" className={PRIMARY_BTN} disabled={pending || !preview?.families} onClick={send}>{pending ? "Sending…" : `Send to ${preview?.families ?? 0} ${preview?.families === 1 ? "family" : "families"}`}</button> : null}
      </div>
    </div>
  );
}
