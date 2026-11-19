"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";

export type EnquiryResult = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const REQUIRED: Record<string, string> = {
  studentName: "Enter your child's name",
  parentName: "Enter the parent or guardian's name",
  phone: "Enter a mobile number we can call",
};

/** Checked in the browser first, so a parent gets the answer at once and the form never loses what was typed. */
function check(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, msg] of Object.entries(REQUIRED)) if (!String(fd.get(k) ?? "").trim()) out[k] = msg;
  const phone = String(fd.get("phone") ?? "");
  if (phone.trim() && phone.replace(/\D/g, "").length < 10) out.phone = "Enter a 10 digit mobile number";
  return out;
}

/** The public admission enquiry form: the four things the office needs first, the rest tucked under "More details". */
export function AdmissionForm({ action, classes, phone }: { action: (fd: FormData) => Promise<EnquiryResult>; classes: string[]; phone?: string }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  const focusFirst = (errs: Record<string, string>) => {
    const name = Object.keys(errs)[0];
    const el = name ? ref.current?.elements.namedItem(name) : null;
    if (el instanceof HTMLElement) {
      if (el.closest("details")) el.closest("details")!.open = true;
      el.focus();
    }
  };

  // onSubmit, not <form action>: React 19 clears a form after its action returns, which would wipe what a parent
  // typed whenever a field is missing or the send fails. Here the fields are only gone once we show "Thank you".
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const local = check(fd);
    if (Object.keys(local).length) { setErrors(local); setError("Please fix the highlighted fields."); focusFirst(local); return; }
    start(async () => {
      setError(null);
      let r: EnquiryResult;
      try { r = await action(fd); }
      catch { r = { ok: false, error: "We could not send your enquiry. Check your internet connection and try again." }; }
      if (r.ok) { setDone(String(fd.get("studentName") ?? "").trim()); setErrors({}); }
      else { const fe = r.fieldErrors ?? {}; setErrors(fe); setError(r.error); focusFirst(fe); }
    });
  };

  if (done !== null) {
    return (
      <div className="st-ok" role="status">
        <b>Thank you. We have your enquiry{done ? ` for ${done}` : ""}.</b>
        Our office will call you within two working days to plan a school visit.
        {phone ? <> Need us sooner? Call <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a>.</> : null}
        <div><button type="button" className="st-btn st-ghost" onClick={() => setDone(null)}>Send another enquiry</button></div>
      </div>
    );
  }

  const field = (name: string, label: string, props: { type?: string; required?: boolean; full?: boolean; autoComplete?: string; inputMode?: "tel" | "email"; hint?: string; placeholder?: string } = {}) => (
    <label className={`st-field${props.full ? " st-full" : ""}`}>
      <span>{label}{props.required ? <span aria-hidden> *</span> : null}</span>
      <input className="st-input" name={name} type={props.type ?? "text"} aria-required={props.required || undefined} autoComplete={props.autoComplete} inputMode={props.inputMode} placeholder={props.placeholder}
        aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `err-${name}` : undefined} />
      {props.hint && !errors[name] ? <span className="st-hint">{props.hint}</span> : null}
      {errors[name] ? <span className="st-err" id={`err-${name}`}>{errors[name]}</span> : null}
    </label>
  );

  return (
    <form ref={ref} onSubmit={submit} className="st-form" noValidate>
      {field("studentName", "Child's name", { required: true, autoComplete: "off" })}
      {classes.length ? (
        <label className="st-field">
          <span>Class applying for</span>
          <select className="st-input" name="classApplying" defaultValue="">
            <option value="">Choose a class</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      ) : field("classApplying", "Class applying for", { placeholder: "For example Class 1" })}
      {field("parentName", "Parent or guardian name", { required: true, autoComplete: "name" })}
      {field("phone", "Mobile number", { type: "tel", required: true, autoComplete: "tel", inputMode: "tel", hint: "We will call this number." })}
      <details className="st-more">
        <summary>More details (optional)</summary>
        <div className="st-form-inner">
          {field("dob", "Child's date of birth", { type: "date" })}
          {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}
          <label className="st-field st-full">
            <span>Anything we should know?</span>
            <textarea className="st-input" name="message" maxLength={1000} />
          </label>
        </div>
      </details>
      <div className="st-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div className="st-full">
        {error ? <p className="st-err" role="alert" style={{ marginBottom: 10 }}>{error}</p> : null}
        <button className="st-btn" type="submit" disabled={pending}>{pending ? "Sending..." : "Send enquiry"}</button>
        <p className="st-hint" style={{ marginTop: 10 }}>We only use these details to contact you about admission.</p>
      </div>
    </form>
  );
}
