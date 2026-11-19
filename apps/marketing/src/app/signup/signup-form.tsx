"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BOARDS, STATES } from "./options";
import { checkSlugAction, signupAction, type SignupOutcome } from "./actions";

type Form = { name: string; board: string; approxStudents: string; adminName: string; email: string; phone: string; state: string; city: string; slug: string };
const EMPTY: Form = { name: "", board: "", approxStudents: "", adminName: "", email: "", phone: "", state: "", city: "", slug: "" };
const STEPS: { title: string; fields: (keyof Form)[] }[] = [
  { title: "Your school", fields: ["name", "board", "approxStudents"] },
  { title: "You", fields: ["adminName", "email", "phone"] },
  { title: "Where", fields: ["state", "city"] },
  { title: "Your address", fields: ["slug"] },
];
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
const INPUT = "h-12 w-full rounded-2xl border border-line-strong bg-white px-4 text-[16px] text-ink outline-none transition-colors focus:border-green focus:ring-2 focus:ring-green/20 aria-[invalid=true]:border-danger";

const REQUIRED: Record<keyof Form, string> = {
  name: "Enter your school's name.", board: "Pick the board your school follows.", approxStudents: "Enter roughly how many students you have.",
  adminName: "Enter your name.", email: "Enter your email address.", phone: "Enter your mobile number.", state: "Pick your state.", city: "Enter your city or town.", slug: "Choose a web address.",
};

function localProblem(f: Form, fields: (keyof Form)[]) {
  const errs: Partial<Record<keyof Form, string>> = {};
  for (const k of fields) if (!f[k].trim()) errs[k] = REQUIRED[k];
  if (fields.includes("email") && f.email && !/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "Enter a valid email address.";
  if (fields.includes("phone") && f.phone && !/^[6-9]\d{9}$/.test(f.phone.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))) errs.phone = "Enter a 10-digit mobile number.";
  if (fields.includes("approxStudents") && f.approxStudents && !(Number(f.approxStudents) >= 1)) errs.approxStudents = "Enter how many students you have.";
  return errs;
}

export function SignupForm({ rootDomain }: { rootDomain: string }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [errs, setErrs] = useState<Partial<Record<keyof Form, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [slugState, setSlugState] = useState<{ status: "idle" | "checking" | "ok" | "bad" | "error"; reason?: string; suggestion?: string }>({ status: "idle" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [done, setDone] = useState<Extract<SignupOutcome, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const [retry, setRetry] = useState(0);
  const set = (k: keyof Form, v: string) => { setF((p) => ({ ...p, [k]: v })); setErrs((p) => ({ ...p, [k]: undefined })); };

  // Offer a subdomain from the school name until the person types their own.
  useEffect(() => { if (!slugTouched && step === 3 && !f.slug) set("slug", slugify(f.name)); }, [step, slugTouched, f.name, f.slug]);

  // Live availability check, debounced; only the newest answer counts.
  useEffect(() => {
    if (step !== 3) return;
    if (f.slug.length < 3) { setSlugState({ status: "idle" }); return; }
    const mine = ++seq.current;
    setSlugState({ status: "checking" });
    const t = setTimeout(async () => {
      const r = await checkSlugAction(f.slug).catch(() => null);
      if (mine !== seq.current) return;
      setSlugState(!r ? { status: "error" } : r.available ? { status: "ok" } : { status: "bad", reason: r.reason, suggestion: r.suggestion });
    }, 350);
    return () => clearTimeout(t);
  }, [f.slug, step, retry]);

  function next() {
    const e = localProblem(f, STEPS[step]!.fields);
    setErrs(e);
    if (Object.keys(e).length === 0) setStep(step + 1);
    else setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
  }

  function submit() {
    if (slugState.status !== "ok") { setErrs({ slug: slugState.reason ?? "Pick an address that is available." }); return; }
    setFormError(null);
    start(async () => {
      const r = await signupAction({ ...f, board: f.board as (typeof BOARDS)[number], approxStudents: Number(f.approxStudents) });
      if (r.ok) { setDone(r); return; }
      setFormError(r.error);
      if (r.fieldErrors) {
        setErrs(r.fieldErrors as Partial<Record<keyof Form, string>>);
        const first = STEPS.findIndex((s) => s.fields.some((k) => r.fieldErrors?.[k]));
        if (first >= 0) setStep(first);
      }
    });
  }

  if (done) {
    return (
      <section aria-live="polite" className="rounded-[2rem] border border-line bg-white p-6 shadow-soft md:p-10">
        <p className="inline-flex rounded-full bg-t-green px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-green">Almost there</p>
        <h2 className="h-display mt-4 text-4xl md:text-5xl">Check your email.</h2>
        {done.emailSent ? (
          <p className="mt-5 max-w-md text-mute">We sent a link to <b className="text-ink">{done.email}</b>. Open it to confirm your address and choose a password. The link works once and for 48 hours.</p>
        ) : (
          <p className="mt-5 max-w-md text-mute">Your school is created, but we could not send the email to <b className="text-ink">{done.email}</b> just now. Please try again in a few minutes.</p>
        )}
        {done.emailSent ? (
          <ol className="mt-8 flex max-w-md flex-col gap-4 text-[15px]">
            {[["Confirm your email", "Open the link and choose a password."], ["We review your school", "Our team reviews every school, usually within one business day. You will get an email."], ["Your 30 days start", "On approval. Add classes and students, and invite your staff."]].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-t-green text-sm font-semibold tabular-nums text-green">{i + 1}</span>
                <span><span className="block font-semibold">{t}</span><span className="text-mute">{d}</span></span>
              </li>
            ))}
          </ol>
        ) : null}
        {done.mailpitUrl ? <p className="mt-6 text-sm text-mute">Development only: <a className="font-semibold text-green underline underline-offset-4" href={done.mailpitUrl} target="_blank" rel="noreferrer">open Mailpit</a> to read the email.</p> : null}
        <Link href="/" className="mt-8 inline-block text-sm text-mute underline underline-offset-4 hover:text-ink">Back to the home page</Link>
      </section>
    );
  }

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-2 text-sm text-mute">
      {label}
      <input className={INPUT} value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errs[k]} aria-describedby={errs[k] ? `${k}-err` : undefined} {...props} />
      {errs[k] ? <span id={`${k}-err`} role="alert" className="text-[13px] text-danger">{errs[k]}</span> : null}
    </label>
  );
  const select = (k: keyof Form, label: string, options: readonly string[]) => (
    <label className="flex flex-col gap-2 text-sm text-mute">
      {label}
      <select className={INPUT} value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errs[k]} aria-describedby={errs[k] ? `${k}-err` : undefined}>
        <option value="">Select</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {errs[k] ? <span id={`${k}-err`} role="alert" className="text-[13px] text-danger">{errs[k]}</span> : null}
    </label>
  );

  return (
    <form className="rounded-[2rem] border border-line bg-white p-6 shadow-soft md:p-10" onSubmit={(e) => { e.preventDefault(); if (step < 3) next(); else submit(); }} noValidate>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-mute">Step {step + 1} of {STEPS.length}</p>
      <ol className="mb-8 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.title} aria-current={i === step ? "step" : undefined} className="flex-1">
            <div className={`h-1 rounded-full ${i <= step ? "bg-green" : "bg-line"}`} />
            <span className={`mt-2 block text-xs ${i === step ? "font-semibold text-ink" : "text-mute"}`}>{s.title}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-5">
        {step === 0 && <>
          {field("name", "School name", { autoComplete: "organization", autoFocus: true, placeholder: "Sunrise Public School" })}
          {select("board", "Board", BOARDS)}
          {field("approxStudents", "About how many students?", { inputMode: "numeric", placeholder: "450" })}
        </>}
        {step === 1 && <>
          {field("adminName", "Your name", { autoComplete: "name", autoFocus: true })}
          {field("email", "Work email", { type: "email", autoComplete: "email", placeholder: "principal@yourschool.in" })}
          {field("phone", "Mobile number", { type: "tel", autoComplete: "tel", placeholder: "98765 43210" })}
        </>}
        {step === 2 && <>
          {select("state", "State", STATES)}
          {field("city", "City or town", { autoComplete: "address-level2" })}
        </>}
        {step === 3 && (
          <div className="flex flex-col gap-2">
            <label htmlFor="slug" className="text-sm text-mute">Choose your school&rsquo;s web address</label>
            <div className="flex h-12 items-center overflow-hidden rounded-2xl border border-line-strong bg-white focus-within:border-green focus-within:ring-2 focus-within:ring-green/20">
              <input id="slug" autoFocus value={f.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }}
                className="h-full min-w-0 flex-1 bg-transparent pl-4 text-[16px] outline-none" inputMode="url" aria-describedby="slug-status" maxLength={30} spellCheck={false} autoCapitalize="none" />
              <span className="pr-4 text-[15px] text-mute">.{rootDomain}</span>
            </div>
            <p id="slug-status" aria-live="polite" className="min-h-5 text-[13px]">
              {slugState.status === "checking" && <span className="text-mute">Checking…</span>}
              {slugState.status === "ok" && <span className="text-ok">{f.slug}.{rootDomain} is available.</span>}
              {slugState.status === "error" && <span className="text-warn">We could not check that just now. <button type="button" className="underline underline-offset-4" onClick={() => setRetry((n) => n + 1)}>Try again</button></span>}
              {f.slug.length > 0 && f.slug.length < 3 && <span className="text-mute">Use at least 3 letters or numbers.</span>}
              {slugState.status === "bad" && (
                <span className="text-danger">{slugState.reason}{" "}
                  {slugState.suggestion ? <button type="button" className="underline underline-offset-4" onClick={() => { setSlugTouched(true); set("slug", slugState.suggestion!); }}>Use {slugState.suggestion}</button> : null}
                </span>
              )}
              {errs.slug && slugState.status !== "bad" && slugState.status !== "error" ? <span role="alert" className="text-danger">{errs.slug}</span> : null}
            </p>
            <p className="text-xs text-mute">Teachers, students and parents will sign in here. You can add your own domain later.</p>
          </div>
        )}
      </div>

      {formError ? <p role="alert" className="mt-5 text-sm text-danger">{formError}</p> : null}

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={() => setStep(step - 1)} disabled={step === 0 || pending} className="min-h-11 px-2 text-sm font-semibold text-mute hover:text-ink disabled:invisible">Back</button>
        <button type="submit" disabled={pending || (step === 3 && slugState.status !== "ok")}
          className="min-h-11 rounded-full bg-green px-7 font-semibold text-white transition-colors hover:bg-green-2 disabled:opacity-50">
          {step < 3 ? "Continue" : pending ? "Creating…" : "Create my school"}
        </button>
      </div>
      <p className="mt-6 text-xs text-mute">Takes about two minutes. No card. By continuing you accept the <Link href="/terms" className="underline underline-offset-4">terms</Link> and <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>.</p>
    </form>
  );
}
