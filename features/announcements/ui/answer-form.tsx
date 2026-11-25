"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { INPUT } from "@smw/ui/tone";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { answerText } from "../answer-text";
import { RELATIONS, type Answer, type ResponseSpec } from "../constants";
import { recordPaperAnswer, respondNotice } from "./actions";

const BY_KEY = "smw-notice-answered-by";
const box = "h-5 w-5 accent-[var(--ds-primary)]";
type Relation = (typeof RELATIONS)[number];
export interface Draft { yes: boolean | null; reason: string; choices: string[]; values: Record<string, string> }
export interface Given { answer: Answer; byName: string; byRelation: string; onPaper: boolean; at: string }

const blank = (a?: Answer | null): Draft => ({
  yes: a?.kind === "consent" ? a.yes : null, reason: a?.kind === "consent" ? a.reason ?? "" : "", choices: a?.kind === "poll" ? a.choices : [], values: a?.kind === "form" ? a.values : {},
});
const toAnswer = (spec: ResponseSpec, d: Draft): Answer | null => {
  switch (spec.kind) {
    case "ack": return { kind: "ack" };
    case "consent": return d.yes === null ? null : { kind: "consent", yes: d.yes, ...(d.reason.trim() ? { reason: d.reason.trim() } : {}) };
    case "poll": return { kind: "poll", choices: d.choices };
    case "form": return { kind: "form", values: Object.fromEntries(Object.entries(d.values).filter(([, v]) => v.trim())) };
    default: return null;
  }
};

/** The inputs for one kind of answer. Shared by the family's form and staff writing down a paper answer. */
export function AnswerFields({ spec, draft, onChange, errors, urgent, paper }: { spec: ResponseSpec; draft: Draft; onChange: (d: Draft) => void; errors: Record<string, string>; urgent?: boolean; paper?: boolean }) {
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });
  if (spec.kind === "ack") return <p className="text-sm text-[var(--ds-on-surface-variant)]">{urgent ? "Press the button to tell the school you are safe and have received this." : "Press the button to say you have read this."}</p>;
  if (spec.kind === "consent") return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Your answer" className="grid grid-cols-2 gap-2">
        {([[true, "Yes"], [false, "No"]] as const).map(([v, label]) => (
          <button key={label} type="button" role="radio" aria-checked={draft.yes === v} onClick={() => set({ yes: v })}
            className={cn("min-h-14 rounded-2xl text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", draft.yes === v ? "bg-[var(--ds-on-surface)] text-[var(--ds-surface)]" : "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]")}>{label}</button>
        ))}
      </div>
      {draft.yes === false && spec.reasonForNo ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium">Why not?
          <textarea rows={2} maxLength={500} value={draft.reason} aria-invalid={!!errors.reason || undefined} onChange={(e) => set({ reason: e.target.value })} className={`${INPUT} h-auto py-2 font-normal`} />
          {errors.reason ? <span role="alert" className="text-xs font-normal text-[var(--ds-color-danger-400)]">{errors.reason}</span> : null}
        </label>
      ) : null}
    </div>
  );
  if (spec.kind === "poll") return (
    <fieldset className="flex flex-col gap-1"><legend className="sr-only">Choose</legend>
      {spec.options.map((o) => (
        <label key={o} className="flex min-h-12 items-center gap-3 rounded-xl bg-white/[0.05] px-4 text-sm">
          <input type={spec.multiple ? "checkbox" : "radio"} name="choice" className={box} checked={draft.choices.includes(o)}
            onChange={(e) => set({ choices: spec.multiple ? (e.target.checked ? [...draft.choices, o] : draft.choices.filter((c) => c !== o)) : [o] })} />{o}
        </label>
      ))}
      {errors.choices ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.choices}</p> : null}
    </fieldset>
  );
  if (spec.kind !== "form") return null;
  return (
    <div className="flex flex-col gap-4">
      {spec.questions.map((q) => {
        const err = errors[`values.${q.id}`], v = draft.values[q.id] ?? "", put = (x: string) => set({ values: { ...draft.values, [q.id]: x } });
        const label = <span className="text-sm font-medium">{q.label}{q.required ? <span aria-hidden> *</span> : null}</span>;
        return (
          <label key={q.id} className="flex flex-col gap-1.5">
            {label}
            {q.kind === "text" ? <textarea rows={2} maxLength={2000} value={v} onChange={(e) => put(e.target.value)} className={`${INPUT} h-auto py-2`} aria-invalid={!!err || undefined} />
              : q.kind === "number" ? <input inputMode="decimal" value={v} onChange={(e) => put(e.target.value)} className={INPUT} aria-invalid={!!err || undefined} />
              : q.kind === "date" ? <input type="date" value={v} onChange={(e) => put(e.target.value)} className={INPUT} aria-invalid={!!err || undefined} />
              : q.kind === "choice" ? <select value={v} onChange={(e) => put(e.target.value)} className={INPUT} aria-invalid={!!err || undefined}><option value="">Choose</option>{q.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : q.kind === "yesno" ? <select value={v} onChange={(e) => put(e.target.value)} className={INPUT} aria-invalid={!!err || undefined}><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select>
              : paper ? <span className="text-sm font-normal text-[var(--ds-on-surface-variant)]">The photo of the slip below answers this.</span>
              : <input type="file" name={`file:${q.id}`} accept="application/pdf,image/png,image/jpeg,image/webp" className={INPUT} />}
            {err ? <span role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{err}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** Who is answering. The login is the family's, so the adult says who they are; this device remembers it. */
export function ByFields({ name, relation, onName, onRelation, errors }: { name: string; relation: string; onName: (v: string) => void; onRelation: (v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm font-medium">Your name
        <input value={name} maxLength={80} autoComplete="name" onChange={(e) => onName(e.target.value)} aria-invalid={!!errors.byName || undefined} className={`${INPUT} font-normal`} />
        {errors.byName ? <span role="alert" className="text-xs font-normal text-[var(--ds-color-danger-400)]">{errors.byName}</span> : null}
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">You are the
        <select value={relation} onChange={(e) => onRelation(e.target.value)} aria-invalid={!!errors.byRelation || undefined} className={`${INPUT} font-normal`}>
          <option value="">Choose</option>{RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {errors.byRelation ? <span role="alert" className="text-xs font-normal text-[var(--ds-color-danger-400)]">{errors.byRelation}</span> : null}
      </label>
    </div>
  );
}

function useRememberedBy() {
  const [by, setBy] = useState({ name: "", relation: "" });
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(BY_KEY) ?? "null"); if (s?.name) setBy({ name: s.name, relation: s.relation ?? "" }); } catch { /* a private window: the person types it again */ } }, []);
  const remember = (b: { name: string; relation: string }) => { try { localStorage.setItem(BY_KEY, JSON.stringify(b)); } catch { /* not remembered */ } };
  return { by, setBy, remember };
}

export interface AnswerCardProps {
  noticeId: string; recipientId: string; childName: string | null; spec: ResponseSpec; urgent: boolean;
  dueAt: string | null; answering: "open" | "locked" | "closed"; given: Given | null; showChild: boolean;
}

/** One child's answer: the form first, a clear "Saved", and the way to change it until the last date. */
export function AnswerCard({ noticeId, recipientId, childName, spec, urgent, dueAt, answering, given, showChild }: AnswerCardProps) {
  const router = useRouter();
  const [now, setNow] = useState<Given | null>(given);
  const [editing, setEditing] = useState(!given);
  const [draft, setDraft] = useState<Draft>(blank(given?.answer));
  const { by, setBy, remember } = useRememberedBy();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const name = by.name || (given?.byName ?? ""), relation = by.relation || (given?.byRelation ?? "");
  const until = dueAt ? `until ${dateTime(dueAt)}` : "any time";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const answer = toAnswer(spec, draft);
    if (!answer) { setErrors({ answer: "Choose your answer first" }); return; }
    const before = now;
    const fd = new FormData(e.currentTarget);
    fd.set("payload", JSON.stringify({ noticeId, recipientId, answer, byName: name.trim(), byRelation: relation }));
    setBusy(true); setErrors({});
    // Paint "Saved" at once; the server confirms, and a refusal puts the form back with what was typed.
    setNow({ answer, byName: name.trim(), byRelation: relation, onPaper: false, at: new Date().toISOString() }); setEditing(false);
    const r = await respondNotice(fd).catch(() => null);
    setBusy(false);
    if (r?.ok) { remember({ name: name.trim(), relation }); router.refresh(); return; }
    setNow(before); setEditing(true);
    setErrors(r && !r.ok ? r.fieldErrors ?? {} : {});
    toast(r && !r.ok ? r.error : "No connection. Your answer was not saved. Try again.", "danger");
  };

  const heading = showChild && childName ? <h3 className="text-sm font-medium text-[var(--ds-on-surface)]">For {childName}</h3> : null;
  let body: ReactNode;
  if (answering !== "open") {
    body = now
      ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Your answer: <span className="font-medium text-[var(--ds-on-surface)]">{answerText(now.answer) || "Saved"}</span>. {answering === "locked" ? `The last date has passed, so answers are locked${dueAt ? ` (${dateTime(dueAt)})` : ""}.` : "This notice is closed."}</p>
      : <p className="text-sm text-[var(--ds-on-surface-variant)]">{answering === "locked" ? "The last date has passed and no answer was saved. Ask the school office if you still need to answer." : "This notice is closed, so it cannot be answered."}</p>;
  } else if (!editing && now) {
    body = (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-sm font-medium text-[var(--ds-color-success-400)]">Saved. You can change this {until}.</p>
        <p className="text-sm text-[var(--ds-on-surface-variant)]">{answerText(now.answer)}{now.onPaper ? " (written down from paper)" : ""} · {now.byName}, {now.byRelation}, {dateTime(now.at)}</p>
        <button type="button" className={`${PILL_BTN} self-start`} onClick={() => { setDraft(blank(now.answer)); setEditing(true); }}>Change my answer</button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <AnswerFields spec={spec} draft={draft} onChange={setDraft} errors={errors} urgent={urgent} />
        {errors.answer ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.answer}</p> : null}
        <ByFields name={name} relation={relation} onName={(v) => setBy({ name: v, relation })} onRelation={(v) => setBy({ name, relation: v })} errors={errors} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className={PRIMARY_BTN}>{spec.kind === "ack" ? (urgent ? "I am safe, received" : "I have read this") : "Save my answer"}</button>
          {now ? <button type="button" className={PILL_BTN} onClick={() => setEditing(false)}>Keep my old answer</button> : null}
          <p className="text-xs text-[var(--ds-on-surface-muted)]">You can change it {until}.</p>
        </div>
      </form>
    );
  }
  return <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.05] p-4">{heading}{body}</div>;
}

/** Staff write down an answer given on paper, with a photo of the slip if they have one. */
export function PaperForm({ noticeId, recipientId, spec, onDone }: { noticeId: string; recipientId: string; spec: ResponseSpec; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(blank());
  const [name, setName] = useState(""), [relation, setRelation] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const answer = toAnswer(spec, draft);
    if (!answer) { setErrors({ answer: "Choose the answer on the paper" }); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("payload", JSON.stringify({ noticeId, recipientId, answer, byName: name.trim(), byRelation: relation as Relation }));
    setBusy(true); setErrors({});
    const r = await recordPaperAnswer(fd).catch(() => null);
    setBusy(false);
    if (r?.ok) { toast("Written down as a paper answer"); onDone(); router.refresh(); return; }
    setErrors(r && !r.ok ? r.fieldErrors ?? {} : {});
    toast(r && !r.ok ? r.error : "No connection. Nothing was saved.", "danger");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-2" noValidate>
      <AnswerFields spec={spec} draft={draft} onChange={setDraft} errors={errors} paper />
      {errors.answer ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.answer}</p> : null}
      <ByFields name={name} relation={relation} onName={setName} onRelation={setRelation} errors={errors} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">Photo of the slip{spec.kind === "form" && spec.questions.some((q) => q.kind === "file" && q.required) ? "" : " (optional)"}
        <input type="file" name="slip" accept="application/pdf,image/png,image/jpeg,image/webp" className={`${INPUT} font-normal`} />
      </label>
      <div className="flex justify-end gap-2"><button type="button" className={PILL_BTN} onClick={onDone}>Cancel</button><button type="submit" disabled={busy} className={PRIMARY_BTN}>Write it down</button></div>
    </form>
  );
}
