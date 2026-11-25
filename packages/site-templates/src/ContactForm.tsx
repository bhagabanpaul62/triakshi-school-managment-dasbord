"use client";

import { normalizePhone } from "./phone";
import { ConsentLine, EnquiryField, Sent, useEnquiryForm } from "./enquiry-form-core";
import type { AdmissionFormProps } from "./AdmissionForm";

function check(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  if (!String(fd.get("parentName") ?? "").trim()) out.parentName = "Enter your name";
  const phone = String(fd.get("phone") ?? "");
  if (!phone.trim()) out.phone = "Enter a mobile number we can call";
  else if (!normalizePhone(phone)) out.phone = "Enter a 10 digit mobile number, or a landline with its area code";
  if (!String(fd.get("message") ?? "").trim()) out.message = "Write your question";
  if (!fd.get("consent")) out.consent = "Please tick the box to say the school may contact you";
  return out;
}

/** The short question form. Questions land in the same enquiry list, marked as questions. */
export function ContactForm({ action, phone, consentText, privacyHref }: Pick<AdmissionFormProps, "action" | "phone" | "consentText" | "privacyHref">) {
  const f = useEnquiryForm(action, check);
  if (f.done) return <Sent done={{ ...f.done, child: "" }} phone={phone} onAgain={() => f.setDone(null)} />;
  return (
    <form ref={f.ref} action={action as unknown as (fd: FormData) => void} onSubmit={f.submit} className="st-form" noValidate={f.scripted}>
      <EnquiryField name="parentName" label="Your name" errors={f.errors} required autoComplete="name" />
      <EnquiryField name="phone" label="Mobile number" errors={f.errors} type="tel" required autoComplete="tel" inputMode="tel" hint="We will call this number." />
      <EnquiryField name="email" label="Email" errors={f.errors} type="email" autoComplete="email" inputMode="email" full />
      <label className="st-field st-full">
        <span>Your question <span aria-hidden>*</span></span>
        <textarea className="st-input" name="message" maxLength={1000} rows={4} required aria-required="true" aria-invalid={f.errors.message ? true : undefined} />
        {f.errors.message ? <span className="st-err">{f.errors.message}</span> : null}
      </label>
      {f.hidden("question")}
      <ConsentLine errors={f.errors} text={consentText} privacyHref={privacyHref} />
      <div className="st-full">
        {f.error ? <p className="st-err" role="alert" style={{ marginBottom: 10 }}>{f.error}</p> : null}
        <button className="st-btn" type="submit" disabled={f.pending}>{f.pending ? "Sending..." : "Send question"}</button>
      </div>
    </form>
  );
}
