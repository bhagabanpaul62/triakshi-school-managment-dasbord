"use client";

import { IconPlus, IconX } from "@tabler/icons-react";
import { INPUT } from "@smw/ui/tone";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { MAX_QUESTIONS, QUESTION_KINDS, type Question, type ResponseSpec } from "../constants";

const KINDS: { value: ResponseSpec["kind"]; label: string }[] = [
  { value: "none", label: "Nothing to answer" }, { value: "ack", label: "I have read this" }, { value: "consent", label: "Yes or no" },
  { value: "poll", label: "Pick an option" }, { value: "form", label: `Short form (up to ${MAX_QUESTIONS} questions)` },
];
const KIND_WORD: Record<Question["kind"], string> = { text: "Text", number: "Number", date: "Date", choice: "Choose one", yesno: "Yes or no", file: "Picture or PDF" };
const EMPTY: Record<ResponseSpec["kind"], ResponseSpec> = {
  none: { kind: "none" }, ack: { kind: "ack" }, consent: { kind: "consent", reasonForNo: false },
  poll: { kind: "poll", options: ["", ""], multiple: false }, form: { kind: "form", questions: [{ id: "q1", label: "", kind: "text", required: true }] },
};
const small = "h-9 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
const box = "h-5 w-5 accent-[var(--ds-primary)]";

export interface ResponseBuilderProps {
  value: ResponseSpec;
  onChange: (v: ResponseSpec) => void;
  disabled?: boolean;
  error?: string;
}

/** What people are asked to do: nothing, confirm, yes or no, pick one, or a short form. */
export function ResponseBuilder({ value, onChange, disabled, error }: ResponseBuilderProps) {
  const setQuestion = (i: number, patch: Partial<Question>) => value.kind === "form" && onChange({ ...value, questions: value.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) });
  return (
    <div className="flex flex-col gap-3">
      <select aria-label="What people are asked to do" value={value.kind} disabled={disabled} onChange={(e) => onChange(EMPTY[e.target.value as ResponseSpec["kind"]])} className={INPUT}>
        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>

      {value.kind === "consent" ? (
        <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" className={box} checked={value.reasonForNo} onChange={(e) => onChange({ ...value, reasonForNo: e.target.checked })} />Ask why when the answer is no</label>
      ) : null}

      {value.kind === "poll" ? (
        <div className="flex flex-col gap-2">
          {value.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Option ${i + 1}`} value={o} maxLength={80} placeholder={`Option ${i + 1}`} className={INPUT} onChange={(e) => onChange({ ...value, options: value.options.map((x, n) => (n === i ? e.target.value : x)) })} />
              {value.options.length > 2 ? <button type="button" aria-label={`Remove option ${i + 1}`} onClick={() => onChange({ ...value, options: value.options.filter((_, n) => n !== i) })} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.08]"><IconX className="h-4 w-4" aria-hidden /></button> : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            {value.options.length < 10 ? <button type="button" className={PILL_BTN} onClick={() => onChange({ ...value, options: [...value.options, ""] })}><IconPlus className="h-4 w-4" aria-hidden />Add an option</button> : null}
            <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" className={box} checked={value.multiple} onChange={(e) => onChange({ ...value, multiple: e.target.checked })} />People may pick more than one</label>
          </div>
        </div>
      ) : null}

      {value.kind === "form" ? (
        <div className="flex flex-col gap-3">
          {value.questions.map((q, i) => (
            <fieldset key={q.id} className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3">
              <legend className="sr-only">Question {i + 1}</legend>
              <div className="flex items-center gap-2">
                <input aria-label={`Question ${i + 1}`} value={q.label} maxLength={200} placeholder={`Question ${i + 1}`} className={INPUT} onChange={(e) => setQuestion(i, { label: e.target.value })} />
                {value.questions.length > 1 ? <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => onChange({ ...value, questions: value.questions.filter((_, n) => n !== i) })} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.08]"><IconX className="h-4 w-4" aria-hidden /></button> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select aria-label={`Kind of answer for question ${i + 1}`} value={q.kind} className={small} onChange={(e) => setQuestion(i, { kind: e.target.value as Question["kind"], options: e.target.value === "choice" ? q.options ?? ["", ""] : undefined })}>
                  {QUESTION_KINDS.map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
                </select>
                <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className={box} checked={q.required} onChange={(e) => setQuestion(i, { required: e.target.checked })} />Required</label>
              </div>
              {q.kind === "choice" ? (
                <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">The choices, one on each line
                  <textarea rows={3} value={(q.options ?? []).join("\n")} onChange={(e) => setQuestion(i, { options: e.target.value.split("\n") })} className={`${INPUT} h-auto py-2 text-sm`} />
                </label>
              ) : null}
            </fieldset>
          ))}
          {value.questions.length < MAX_QUESTIONS ? <button type="button" className={`${PILL_BTN} self-start`} onClick={() => onChange({ ...value, questions: [...value.questions, { id: `q${Math.max(0, ...value.questions.map((q) => Number(q.id.slice(1)) || 0)) + 1}`, label: "", kind: "text", required: true }] })}><IconPlus className="h-4 w-4" aria-hidden />Add a question</button> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}
    </div>
  );
}

/** The spec with empty choices dropped, or null while it is still half written. */
export function cleanSpec(v: ResponseSpec): ResponseSpec | null {
  if (v.kind === "poll") { const options = v.options.map((o) => o.trim()).filter(Boolean); return options.length >= 2 ? { ...v, options } : null; }
  if (v.kind === "form") {
    const questions = v.questions.map((q) => ({ ...q, label: q.label.trim(), ...(q.kind === "choice" ? { options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}) }));
    return questions.every((q) => q.label && (q.kind !== "choice" || (q.options?.length ?? 0) >= 2)) ? { ...v, questions } : null;
  }
  return v;
}
