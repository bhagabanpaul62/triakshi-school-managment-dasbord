"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBook2, IconX } from "@tabler/icons-react";
import { cn } from "@smw/ui/utils";
import { INPUT } from "@smw/ui/tone";
import { FilesField } from "@smw/ui/comm/FilesField";
import { PRIMARY_BTN } from "@smw/ui/finance/ui";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { filesTotalProblem } from "@smw/feature-kit/support-sla";
import { CATEGORY_LABELS, MAX_FILES, MAX_FILE_MB, PRIORITY_LABELS, TICKET_CATEGORIES, TICKET_PRIORITIES, type TicketCategory, type TicketPriority } from "../inputs";

const label = "text-sm font-medium text-[var(--ds-on-surface)]";
const err = "text-xs text-[var(--ds-color-danger-400)]";
const HINT: Record<TicketPriority, string> = { low: "No rush", normal: "We will reply within a working day", high: "Work has stopped for some people", urgent: "Nobody can use the school panel" };
type Suggestion = { slug: string; title: string; summary: string };

/** The page where a ticket is written. Matching help articles appear under the subject while typing; the page and browser we caught are shown and can be removed. */
export function TicketForm({ action, suggest, defaults, context, followUp, canAsk }: {
  action: (fd: FormData) => Promise<FormResult>;
  suggest: (q: string) => Promise<{ ok: true; data: Suggestion[] } | { ok: false; error: string }>;
  defaults: { subject: string; category: TicketCategory; article: string | null; articleTitle: string | null };
  context: { page: string | null; browser: string | null };
  followUp: { id: string; ref: string } | null;
  canAsk: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<TicketCategory>(defaults.category);
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [keepPage, setKeepPage] = useState(!!context.page);
  const [keepBrowser, setKeepBrowser] = useState(!!context.browser);
  const [subject, setSubject] = useState(defaults.subject);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = subject.trim();
    const mine = ++seq.current;
    if (q.length < 4) { setFound([]); return; }
    const t = setTimeout(async () => { const r = await suggest(q); if (mine === seq.current) setFound(r.ok ? r.data.filter((a) => a.slug !== defaults.article) : []); }, 350);
    return () => clearTimeout(t);
  }, [subject, suggest, defaults.article]);

  const submit = (fd: FormData) => start(async () => {
    setErrors({}); setLost(null);
    const tooMuch = filesTotalProblem(fd.getAll("files").map((f) => (f instanceof File ? f.size : 0)));
    if (tooMuch) { setErrors({ files: tooMuch }); return; }
    const r = await action(fd);
    if (r.ok) { toast("Sent. We will reply here."); router.push(`/app/support/${(r.data as { id: string }).id}`); return; }
    setErrors(r.fieldErrors ?? {});
    if (!r.fieldErrors || !Object.keys(r.fieldErrors).some((k) => ["subject", "body", "files"].includes(k))) setLost(r.error);
  });

  if (!canAsk) return <p className="text-sm text-[var(--ds-on-surface-muted)]">Only staff can write to Triakshi. Ask your school office.</p>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="mx-auto flex max-w-2xl flex-col gap-6 pb-24" noValidate>
      {followUp ? <p className="rounded-2xl bg-white/[0.05] p-3 text-sm">This is a follow-up to <Link href={`/app/support/${followUp.id}`} className="underline underline-offset-4">{followUp.ref}</Link>. We will see the old ticket with it.<input type="hidden" name="followUpOf" value={followUp.id} /></p> : null}
      {defaults.article ? <p className="rounded-2xl bg-white/[0.05] p-3 text-sm">You were reading <Link href={`/app/support/help/${defaults.article}`} className="underline underline-offset-4">{defaults.articleTitle ?? "a help article"}</Link>. We will see which one.<input type="hidden" name="article" value={defaults.article} /></p> : null}

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>What is it about?</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of ticket">
          {TICKET_CATEGORIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === category} onClick={() => setCategory(c)}
              className={cn("min-h-11 rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", c === category ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>{CATEGORY_LABELS[c]}</button>
          ))}
        </div>
        <input type="hidden" name="category" value={category} />
        {category === "closure" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Nothing is deleted when you send this. We will write back with what happens and when. <Link href="/app/settings" className="underline underline-offset-4">Take a copy of your data first</Link>.</p> : null}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="subject" className={label}>Subject</label>
        <input id="subject" name="subject" value={subject} onChange={(e) => { setSubject(e.target.value); setErrors((x) => ({ ...x, subject: "" })); }} maxLength={150} className={INPUT} placeholder="For example: Fee receipts are not printing" autoComplete="off" aria-invalid={!!errors.subject || undefined} />
        {errors.subject ? <p role="alert" className={err}>{errors.subject}</p> : null}
        {found.length ? (
          <div className="mt-1 flex flex-col gap-1 rounded-2xl bg-white/[0.04] p-2" aria-live="polite">
            <p className="px-2 pt-1 text-xs text-[var(--ds-on-surface-muted)]">These may answer it already</p>
            {found.map((a) => (
              <Link key={a.slug} href={`/app/support/help/${a.slug}`} target="_blank" rel="noopener" className="flex min-h-11 items-start gap-2 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.07]">
                <IconBook2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
                <span><span className="block text-[var(--ds-on-surface)]">{a.title}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{a.summary}</span></span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className={label}>Tell us more</label>
        <textarea id="body" name="body" rows={6} maxLength={5000} className={cn(INPUT, "h-auto py-2.5 leading-6")} placeholder="What you did, what you expected, what happened." aria-invalid={!!errors.body || undefined} onChange={() => setErrors((x) => ({ ...x, body: "" }))} />
        {errors.body ? <p role="alert" className={err}>{errors.body}</p> : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>How urgent is it?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How urgent">
          {TICKET_PRIORITIES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={p === priority} onClick={() => setPriority(p)}
              className={cn("flex min-h-14 flex-col items-start justify-center rounded-2xl px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", p === priority ? "bg-[var(--ds-on-surface)] text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>
              <span className="font-medium">{PRIORITY_LABELS[p]}</span>
              <span className={cn("text-xs", p === priority ? "text-[var(--ds-surface)]/70" : "text-[var(--ds-on-surface-muted)]")}>{HINT[p]}</span>
            </button>
          ))}
        </div>
        <input type="hidden" name="priority" value={priority} />
      </fieldset>

      <div className="flex flex-col gap-1">
        <FilesField label="Pictures or PDFs (optional)" accept={["application/pdf", "image/*"]} maxCount={MAX_FILES} maxMb={MAX_FILE_MB} />
        {errors.files ? <p role="alert" className={err}>{errors.files}</p> : null}
      </div>

      {context.page || context.browser ? (
        <div className="flex flex-col gap-2">
          <p className={label}>We will send this with it</p>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">It helps us see what you saw. Remove anything you do not want to share.</p>
          <div className="flex flex-wrap gap-2">
            {context.page ? <Chip text={`Page: ${context.page}`} on={keepPage} toggle={() => setKeepPage((v) => !v)} /> : null}
            {context.browser ? <Chip text={`Browser: ${context.browser}`} on={keepBrowser} toggle={() => setKeepBrowser((v) => !v)} /> : null}
          </div>
          {context.page ? <><input type="hidden" name="page" value={context.page} />{keepPage ? <input type="hidden" name="keepPage" value="1" /> : null}</> : null}
          {context.browser ? <><input type="hidden" name="browser" value={context.browser} />{keepBrowser ? <input type="hidden" name="keepBrowser" value="1" /> : null}</> : null}
        </div>
      ) : null}

      {lost ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{lost}</p> : null}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Link href="/app/support" className="inline-flex h-10 items-center rounded-full px-4 text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.06]">Cancel</Link>
        <button type="submit" disabled={pending} className={PRIMARY_BTN}>{pending ? "Sending…" : "Send to Triakshi"}</button>
      </div>
    </form>
  );
}

function Chip({ text, on, toggle }: { text: string; on: boolean; toggle: () => void }) {
  return (
    <span className={cn("inline-flex min-h-9 max-w-full items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-3 pr-1 text-xs", !on && "line-through opacity-60")}>
      <span className="truncate">{text}</span>
      <button type="button" onClick={toggle} aria-label={on ? `Remove: ${text}` : `Put back: ${text}`} aria-pressed={!on} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
        {on ? <IconX className="h-3.5 w-3.5" aria-hidden /> : <span className="text-[10px] no-underline">Add</span>}
      </button>
    </span>
  );
}
