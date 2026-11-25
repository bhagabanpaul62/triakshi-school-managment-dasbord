"use client";

import { normalizePhone } from "./phone";
import { ConsentLine, EnquiryField, Sent, useEnquiryForm, type EnquiryAction } from "./enquiry-form-core";

export type { EnquiryResult } from "./enquiry-form-core";

const REQUIRED: Record<string, string> = { studentName: "Enter your child's name", parentName: "Enter the parent or guardian's name", phone: "Enter a mobile number we can call" };

function check(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, msg] of Object.entries(REQUIRED)) if (!String(fd.get(k) ?? "").trim()) out[k] = msg;
  const phone = String(fd.get("phone") ?? "");
  if (phone.trim() && !normalizePhone(phone)) out.phone = "Enter a 10 digit mobile number, or a landline with its area code";
  if (!fd.get("consent")) out.consent = "Please tick the box to say the school may contact you";
  return out;
}

export interface AdmissionFormProps {
  /** The server action behind the form. */
  action: EnquiryAction;
  /** The school's classes (the page narrows them with the section's list). */
  classes?: string[];
  /** The sessions to choose from, when next year exists. */
  sessions?: string[];
  session?: string;
  phone?: string;
  consentText?: string;
  privacyHref?: string;
}

/** The public admission enquiry form: the four things the office needs first, the rest under "More details", and the parent's consent. */
export function AdmissionForm({ action, classes = [], sessions = [], session, phone, consentText, privacyHref }: AdmissionFormProps) {
  const f = useEnquiryForm(action, check);
  if (f.done) return <Sent done={f.done} phone={phone} onAgain={() => f.setDone(null)} />;
  return (
    <form ref={f.ref} action={action as unknown as (fd: FormData) => void} onSubmit={f.submit} className="st-form" noValidate={f.scripted}>
      <EnquiryField name="studentName" label="Child's name" errors={f.errors} required autoComplete="off" />
      {classes.length ? (
        <label className="st-field">
          <span>Class applying for</span>
          <select className="st-input" name="classApplying" defaultValue="">
            <option value="">Choose a class</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      ) : <EnquiryField name="classApplying" label="Class applying for" errors={f.errors} placeholder="For example Class 1" />}
      {sessions.length > 1 ? (
        <label className="st-field">
          <span>Session</span>
          <select className="st-input" name="session" defaultValue={session ?? sessions[0]}>{sessions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          {f.errors.session ? <span className="st-err">{f.errors.session}</span> : null}
        </label>
      ) : null}
      <EnquiryField name="parentName" label="Parent or guardian name" errors={f.errors} required autoComplete="name" />
      <EnquiryField name="phone" label="Mobile number" errors={f.errors} type="tel" required autoComplete="tel" inputMode="tel" hint="We will call this number." />
      <details className="st-more">
        <summary>More details (optional)</summary>
        <div className="st-form-inner">
          <EnquiryField name="dob" label="Child's date of birth" errors={f.errors} type="date" />
          <EnquiryField name="email" label="Email" errors={f.errors} type="email" autoComplete="email" inputMode="email" hint="We will send your reference here." />
          <label className="st-field st-full">
            <span>Anything we should know?</span>
            <textarea className="st-input" name="message" maxLength={1000} />
          </label>
        </div>
      </details>
      {f.hidden("admission")}
      <ConsentLine errors={f.errors} text={consentText} privacyHref={privacyHref} />
      <div className="st-full">
        {f.error ? <p className="st-err" role="alert" style={{ marginBottom: 10 }}>{f.error}</p> : null}
        <button className="st-btn" type="submit" disabled={f.pending}>{f.pending ? "Sending..." : "Send enquiry"}</button>
      </div>
    </form>
  );
}
