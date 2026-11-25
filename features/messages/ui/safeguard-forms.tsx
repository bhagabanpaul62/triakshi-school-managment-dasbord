"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { REPORT_STATE_WORDS, RESTRICTION_WORDS } from "../constants";
import { useFormErrors } from "./form-errors";
import { handleReport, liftRestriction, openReview, restrictPerson, searchPeople } from "./actions";
import { PILL_BTN, PRIMARY_BTN } from "./styles";

const label = "text-sm text-[var(--ds-on-surface-variant)]";
const fail = (e: string) => <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{e}</p>;

/** Opening a conversation you are not in needs a typed reason, every time. It goes in the log the other side can rely on. */
export function ReviewForm({ threadId, reportId }: { threadId: string; reportId?: string }) {
  const f = useFormErrors(["reason"]);
  const errors = f.errors;
  const [pending, run] = useTransition();
  return (
    <form noValidate onChange={f.onChange} onSubmit={keepValues((fd) => run(async () => { const r = await openReview(fd); if (r && !r.ok) { f.fail(r); toast(r.error, "danger"); } }))} className="flex flex-col gap-2">
      <input type="hidden" name="threadId" value={threadId} />
      {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
      <label className={label} htmlFor="review-reason">Why are you opening this conversation?</label>
      <textarea id="review-reason" name="reason" required rows={3} maxLength={500} placeholder="For example: report about pressure to pay for extra lessons" className={cn(INPUT, "h-auto py-2")} aria-invalid={!!errors.reason || undefined} />
      {errors.reason ? fail(errors.reason) : <p className="text-xs text-[var(--ds-on-surface-muted)]">Your name, the time and your reason are logged. While a concern is open nobody is told you read it; otherwise both sides see that the school reviewed it.</p>}
      {f.note}
      <div><button type="submit" disabled={pending} className={PRIMARY_BTN}>{pending ? "Opening…" : "Open the conversation"}</button></div>
    </form>
  );
}

export function HandleForm({ reportId, state, outcome }: { reportId: string; state: string; outcome: string | null }) {
  const router = useRouter();
  const [pending, run] = useTransition();
  const f = useFormErrors(["state"]);
  const errors = f.errors;
  const states = ["reviewing", "action", "no_action"] as const;
  return (
    <form noValidate onChange={f.onChange} onSubmit={keepValues((fd) => run(async () => { const r = await handleReport(fd); if (r.ok) { f.reset(); toast("Saved. The reporter was told."); router.refresh(); } else { f.fail(r); toast(r.error, "danger"); } }))} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} />
      <fieldset className="flex flex-col gap-2"><legend className={label}>Where does it stand?</legend>
        {states.map((s) => (
          <label key={s} className="flex min-h-10 items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2"><input type="radio" name="state" value={s} defaultChecked={s === (state === "new" ? "reviewing" : state)} />{REPORT_STATE_WORDS[s]}</label>
        ))}
        {errors.state ? fail(errors.state) : null}
      </fieldset>
      <label className={label}>What was decided (kept private, the reporter sees only the state)
        <textarea name="outcome" rows={3} maxLength={1000} defaultValue={outcome ?? ""} className={cn(INPUT, "mt-1 h-auto py-2")} /></label>
      {f.note}
      <div><button type="submit" disabled={pending} className={PRIMARY_BTN}>{pending ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

export function RestrictForm() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; label: string }[]>([]);
  const [who, setWho] = useState<{ id: string; name: string; label: string } | null>(null);
  const f = useFormErrors(["userId", "until", "reason"]);
  const errors = f.errors;
  const [pending, run] = useTransition();
  const latest = useRef(0);
  useEffect(() => {
    const n = ++latest.current;
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => { const f = new FormData(); f.set("q", q); const r = await searchPeople(f); if (n === latest.current && r.ok) setFound(r.data); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <form noValidate onChange={f.onChange} onSubmit={keepValues((fd, reset) => run(async () => {
      if (who) fd.set("userId", who.id);
      const r = await restrictPerson(fd);
      if (r.ok) { reset(); f.reset(); setWho(null); setQ(""); toast("Limit set. They were told."); router.refresh(); } else { f.fail(r); toast(r.error, "danger"); }
    }))} className="flex flex-col gap-3">
      <div>
        <label className={label} htmlFor="limit-who">Who</label>
        {who ? (
          <p className="mt-1 flex items-center justify-between gap-2 rounded-2xl bg-white/[0.05] p-3 text-sm">{who.name} <span className="text-[var(--ds-on-surface-muted)]">{who.label}</span><button type="button" className={PILL_BTN} onClick={() => { setWho(null); f.clear("userId"); }}>Change</button></p>
        ) : (
          <>
            <input id="limit-who" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name of the staff member or the student" autoComplete="off" className={cn(INPUT, "mt-1")} />
            {found.length ? <ul className="mt-1 rounded-2xl bg-white/[0.035] p-1" aria-label="People found">{found.map((p) => <li key={p.id}><button type="button" onClick={() => setWho(p)} className="flex w-full justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.06]">{p.name}<span className="text-[var(--ds-on-surface-muted)]">{p.label}</span></button></li>)}</ul> : null}
          </>
        )}
        {errors.userId ? fail(errors.userId) : null}
      </div>
      <fieldset className="flex flex-col gap-2"><legend className={label}>How far</legend>
        {(Object.entries(RESTRICTION_WORDS) as [string, string][]).map(([k, v], i) => <label key={k} className="flex min-h-10 items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2"><input type="radio" name="kind" value={k} defaultChecked={i === 0} />{v}</label>)}
      </fieldset>
      <label className={label}>Until (last day)<input type="date" name="until" required className={cn(INPUT, "mt-1 block")} />{errors.until ? fail(errors.until) : null}</label>
      <label className={label}>Reason (they are told, and it is logged)<textarea name="reason" required rows={3} maxLength={500} className={cn(INPUT, "mt-1 h-auto py-2")} />{errors.reason ? fail(errors.reason) : null}</label>
      {f.note}
      <div><button type="submit" disabled={pending || !who} className={PRIMARY_BTN}>{pending ? "Saving…" : "Set the limit"}</button></div>
    </form>
  );
}

export function LiftButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, run] = useTransition();
  return <button type="button" disabled={pending} className={PILL_BTN} onClick={() => run(async () => { const r = await liftRestriction(id); if (r.ok) { toast("Limit lifted"); router.refresh(); } else toast(r.error, "danger"); })}>Lift now</button>;
}
