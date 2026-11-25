"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ENQUIRY_CONSENT_TEXT } from "./consent";
import { EnquiryThanks } from "./Thanks";

export type EnquiryResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };
export type EnquiryAction = (fd: FormData) => Promise<EnquiryResult>;

/** Read in the browser first, so a parent gets the answer at once and nothing typed is lost. */
type Check = (fd: FormData) => Record<string, string>;

/**
 * What both public forms share. Works without JavaScript: the form posts straight to the server action, which sends the visitor to the thank-you
 * page. With JavaScript the same action is called from here (`js` = 1), so errors show next to the field and the typed text stays.
 * `ts` (when the form opened) is the time trap; `utm_*` carry the campaign the visitor came from.
 */
export function useEnquiryForm(action: EnquiryAction, check: Check) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ child: string } | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const path = usePathname();
  const [js, setJs] = useState("");
  const [ts, setTs] = useState("");
  const [utm, setUtm] = useState<{ source: string; campaign: string }>({ source: "", campaign: "" });
  useEffect(() => {
    setJs("1"); setTs(String(Date.now()));
    const q = new URLSearchParams(window.location.search);
    setUtm({ source: q.get("utm_source") ?? "", campaign: q.get("utm_campaign") ?? "" });
  }, []);

  const focusFirst = (errs: Record<string, string>) => {
    const el = ref.current?.elements.namedItem(Object.keys(errs)[0] ?? "");
    if (el instanceof HTMLElement) { el.closest("details")?.setAttribute("open", ""); el.focus(); }
  };
  // onSubmit, not only <form action>: React 19 clears a form after its action returns, which would wipe what a parent typed.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const local = check(fd);
    if (Object.keys(local).length) { setErrors(local); setError("Please fix the highlighted fields."); focusFirst(local); return; }
    start(async () => {
      setError(null);
      let r: EnquiryResult;
      try { r = await action(fd); } catch { r = { ok: false, error: "We could not send your enquiry. Check your internet connection and try again." }; }
      if (r.ok) { setDone({ child: String(fd.get("studentName") ?? "").trim() }); setErrors({}); }
      else { const fe = r.fieldErrors ?? {}; setErrors(fe); setError(r.error); focusFirst(fe); }
    });
  };
  const hidden = (kind: "admission" | "question") => (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="returnTo" value={path || "/"} />
      <input type="hidden" name="js" value={js} />
      <input type="hidden" name="ts" value={ts} />
      <input type="hidden" name="utm_source" value={utm.source} />
      <input type="hidden" name="utm_campaign" value={utm.campaign} />
      <div className="st-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    </>
  );
  return { pending, errors, error, done, setDone, ref, submit, hidden, scripted: js === "1" };
}

export interface FieldProps { name: string; label: string; errors: Record<string, string>; type?: string; required?: boolean; full?: boolean; autoComplete?: string; inputMode?: "tel" | "email"; hint?: string; placeholder?: string }

export function EnquiryField({ name, label, errors, type = "text", required, full, autoComplete, inputMode, hint, placeholder }: FieldProps) {
  return (
    <label className={`st-field${full ? " st-full" : ""}`}>
      <span>{label}{required ? <span aria-hidden> *</span> : null}</span>
      <input className="st-input" name={name} type={type} required={required} aria-required={required || undefined} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder}
        aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `err-${name}` : undefined} />
      {hint && !errors[name] ? <span className="st-hint">{hint}</span> : null}
      {errors[name] ? <span className="st-err" id={`err-${name}`}>{errors[name]}</span> : null}
    </label>
  );
}

/** The line a parent must tick: its words are kept with the enquiry. */
export function ConsentLine({ errors, text = ENQUIRY_CONSENT_TEXT, privacyHref = "/privacy" }: { errors: Record<string, string>; text?: string; privacyHref?: string }) {
  return (
    <div className="st-full">
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <input type="checkbox" name="consent" value="true" required aria-required="true" aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "err-consent" : undefined} style={{ marginTop: 4, width: 18, height: 18, flex: "none" }} />
        <span className="st-hint" style={{ margin: 0 }}>{text} <a href={privacyHref} target="_blank" rel="noopener noreferrer">Privacy</a> *</span>
      </label>
      {errors.consent ? <span className="st-err" id="err-consent">{errors.consent}</span> : null}
    </div>
  );
}

export function Sent({ done, phone, onAgain, children }: { done: { child: string }; phone?: string; onAgain: () => void; children?: ReactNode }) {
  return (
    <div className="st-ok" role="status">
      <EnquiryThanks child={done.child} phone={phone} />
      {children}
      <div><button type="button" className="st-btn st-ghost" onClick={onAgain}>Send another</button></div>
    </div>
  );
}
