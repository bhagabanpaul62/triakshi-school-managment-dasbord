"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { FilesField } from "@smw/ui/comm/FilesField";
import { FileList } from "@smw/ui/comm/FileList";
import { MarkdownEditor } from "@smw/ui/comm/MarkdownEditor";
import { PhonePreview } from "@smw/ui/comm/PhonePreview";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/tone";
import { cn } from "@smw/ui/utils";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import { quietUntil } from "@smw/feature-notifications/quiet";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { MAX_FILES, NEEDS_APPROVAL, NO_URGENT_CATEGORY, type NoticeType, type Reminders, type ResponseSpec } from "../constants";
import { publicAudience, readyErrors, RESPONSE_WORDS, type NoticeContent } from "../content";
import { checkNotice, correctNotice, saveCorrectionAsNew, addNoticeFile, publishNotice, removeNoticeFile, reorderNoticeFiles, saveNotice, scheduleNotice, submitNotice } from "./actions";
import { NoticeCard } from "./card";
import { cleanSpec, ResponseBuilder } from "./response-builder";
import { TYPE_LABEL } from "./shared";
import { fromIstInput, istHm, plural } from "@smw/feature-kit/words";

export type WebsiteChoice = "app" | "site" | "only";
export interface FormInitial {
  id: string | null;
  mode: "draft" | "correct";
  type: NoticeType; categoryId: string; title: string; body: string; lang2: string; title2: string; body2: string;
  audience: Audience; response: ResponseSpec; dueAt: string; reminders: Reminders; website: WebsiteChoice; pinnedUntil: string; expiresAt: string;
  files: { id: string; name: string; size: number; contentType: string }[];
}
export interface NoticeFormProps {
  initial: FormInitial;
  categories: { id: string; name: string; tone: string }[];
  options: AudienceOptions;
  /** Names for audience rules that arrive filled in (a single student or person). */
  labels: Record<string, string>;
  languages: string[];
  attachments: boolean;
  may: { publish: boolean; urgent: boolean; website: boolean; websiteApproval: boolean };
  /** What the person's own sections allow before anyone has picked an audience. */
  defaultMode: "free" | "approval";
  quiet: { from: string; to: string; sundays: boolean };
  readOnly: boolean;
}

type F = Omit<FormInitial, "id" | "mode" | "files">;
type Check = { mode: "free" | "approval"; approvers: string[]; school: { students: number; classes: number }; people: { families: number; staff: number; total: number; sample: string[]; unreachable: { name: string; label: string; why: string }[]; text: string } };
type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "failed"; message: string };
type Errors = Record<string, string>;

const REMINDERS: [keyof Reminders, string][] = [["before", "Two days before"], ["onDay", "On the last day"], ["after", "The day after"]];
const box = "h-5 w-5 accent-[var(--ds-primary)]";

function Row({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--ds-on-surface)]">{label}</label>
      {children}
      {error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : hint ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p> : null}
    </div>
  );
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6"><h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{title}</h2>{children}</section>
);

/** What the server needs, from what is on the screen. A cleared field is sent as null so it really clears. */
function payload(f: F, o: { id: string | null; correcting: boolean }): Record<string, unknown> {
  const spec = cleanSpec(f.response);
  const only = f.website === "only";
  return {
    ...(o.id ? { id: o.id } : {}), ...(o.correcting ? {} : { type: f.type }),
    categoryId: f.categoryId || null, title: f.title, body: f.body, lang2: f.lang2 || null, title2: f.lang2 ? f.title2 : null, body2: f.lang2 ? f.body2 : null,
    ...(only || !f.audience.include.length ? {} : { audience: f.audience }), websiteOnly: only, website: f.website !== "app",
    ...(spec ? { response: spec } : {}), dueAt: fromIstInput(f.dueAt), reminders: f.reminders, expiresAt: fromIstInput(f.expiresAt), pinnedUntil: fromIstInput(f.pinnedUntil),
  };
}

export function NoticeForm({ initial, categories, options, labels, languages, attachments, may, defaultMode, quiet, readOnly }: NoticeFormProps) {
  const router = useRouter();
  const correcting = initial.mode === "correct";
  const [f, setF] = useState<F>(() => { const { id: _i, mode: _m, files: _f, ...rest } = initial; return rest; });
  const [files, setFiles] = useState(initial.files);
  const [filesKey, setFilesKey] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Errors>({});
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [lang, setLang] = useState<"main" | "second">("main");
  const [check, setCheck] = useState<Check | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "send" | "schedule">(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notifyAgain, setNotifyAgain] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);

  const id = useRef(initial.id);
  const rev = useRef(0), savedRev = useRef(0), nextTry = useRef(0), tries = useRef(0);
  const inflight = useRef<Promise<boolean> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(f);
  latest.current = f;
  const dirty = rev.current !== savedRev.current || status.kind === "failed";

  const set = (patch: Partial<F>) => { rev.current++; if ("audience" in patch) setNeedsApproval(false); setF((p) => ({ ...p, ...patch })); setErrors((e) => { const n = { ...e }; for (const k of Object.keys(patch)) delete n[k]; return n; }); };
  const urgent = f.type === "urgent";
  const onlyWebsite = f.website === "only";
  const publicOk = onlyWebsite || publicAudience(f.audience);
  const spec = cleanSpec(f.response);

  // ---- files: the pickers keep their picks in hidden inputs; they are uploaded with the next save ----
  const pendingFiles = () => Array.from(root.current?.querySelector<HTMLInputElement>("input[type=file][name=files]")?.files ?? []);
  const pendingRemovals = () => Array.from(root.current?.querySelectorAll<HTMLInputElement>("input[name=removeIds]") ?? []).map((i) => i.value);
  const syncFiles = async (noticeId: string): Promise<string | null> => {
    let problem: string | null = null, list = files;
    for (const fileId of pendingRemovals()) {
      const fd = new FormData(); fd.set("id", noticeId); fd.set("fileId", fileId);
      const r = await removeNoticeFile(fd);
      if (r.ok) list = r.data; else problem = r.error;
    }
    for (const file of pendingFiles()) {
      const fd = new FormData(); fd.set("id", noticeId); fd.set("file", file);
      const r = await addNoticeFile(fd);
      if (r.ok) list = r.data; else problem = `${file.name} was not added: ${r.error}`;
    }
    setFiles(list); setFilesKey((k) => k + 1);
    return problem;
  };

  /** Move a saved file up or down: shown at once, saved after, put back with a message if it fails. */
  const moveFile = async (i: number, by: -1 | 1) => {
    const before = files, next = [...files];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setFiles(next);
    const fd = new FormData(); fd.set("id", id.current!); fd.set("ids", JSON.stringify(next.map((x) => x.id)));
    const r = await reorderNoticeFiles(fd).catch(() => null);
    if (!r || !r.ok) { setFiles(before); toast(r && !r.ok ? r.error : "No connection. The order did not change.", "danger"); }
  };

  /** Save everything now. Resolves true when nothing is left unsaved. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    while (inflight.current) await inflight.current;
    const wantFiles = attachments && !correcting && (pendingFiles().length > 0 || pendingRemovals().length > 0);
    if (correcting || (rev.current === savedRev.current && !wantFiles && status.kind !== "failed")) return true;
    const run = (async () => {
      const at = rev.current;
      setStatus({ kind: "saving" });
      const fd = new FormData();
      fd.set("payload", JSON.stringify(payload(latest.current, { id: id.current, correcting: false })));
      const r = await saveNotice(fd).catch(() => null);
      if (!r || !r.ok) {
        const message = r ? r.error : "No connection. Your text is still here.";
        tries.current++; nextTry.current = Date.now() + Math.min(30_000, 3000 * 2 ** tries.current);
        if (r && !r.ok && r.fieldErrors) setErrors(r.fieldErrors);
        setStatus({ kind: "failed", message });
        return false;
      }
      tries.current = 0;
      if (!id.current) { id.current = r.data.id; window.history.replaceState(null, "", `/app/announcements/${r.data.id}/edit`); }
      savedRev.current = at;
      if (wantFiles) { const problem = await syncFiles(id.current); if (problem) toast(problem, "danger"); }
      setStatus({ kind: "saved", at: new Date() });
      return rev.current === savedRev.current;
    })();
    inflight.current = run;
    try { return await run; } finally { inflight.current = null; }
    // the refs and setters are stable; status is read only to retry after a failure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, attachments, correcting, status.kind, files]);

  // Autosave every 3 seconds when something changed; after a failure, retry with a growing wait.
  useEffect(() => {
    if (readOnly || correcting) return;
    const t = setInterval(() => {
      const wantFiles = attachments && (pendingFiles().length > 0 || pendingRemovals().length > 0);
      if (!inflight.current && (rev.current !== savedRev.current || wantFiles) && Date.now() >= nextTry.current) void flush();
    }, 3000);
    return () => clearInterval(t);
  }, [flush, readOnly, correcting, attachments]);

  // Leaving warns only when something is not saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.metaKey || e.ctrlKey || a.target === "_blank" || a.origin !== location.origin || a.pathname === location.pathname) return;
      if (!confirm("Some of your changes are not saved yet. Leave anyway?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", click, true); };
  }, [dirty]);

  // Who it reaches, and whether it needs approval: asked again a moment after the audience changes.
  const audienceJson = JSON.stringify(f.audience);
  useEffect(() => {
    setCheck(null); setCheckError(null);
    if (onlyWebsite || !f.audience.include.length || readOnly) return;
    const t = setTimeout(async () => {
      const fd = new FormData(); fd.set("audience", audienceJson);
      const r = await checkNotice(fd).catch(() => null);
      if (!r) setCheckError("Could not check who this reaches.");
      else if (r.ok) setCheck(r.data as Check); else setCheckError(r.error);
    }, 400);
    return () => clearTimeout(t);
    // audienceJson stands for the audience
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceJson, onlyWebsite, readOnly]);

  const mode: "free" | "approval" = !may.publish || (f.website !== "app" && may.websiteApproval) ? "approval" : onlyWebsite ? "free" : check?.mode ?? defaultMode;
  const content = (): NoticeContent => ({
    type: f.type, categoryId: f.categoryId || null, title: f.title, body: f.body, lang2: f.lang2 || null, title2: f.lang2 ? f.title2 : null, body2: f.lang2 ? f.body2 : null,
    audience: f.audience, response: spec ?? { kind: "none" }, dueAt: f.dueAt ? new Date(fromIstInput(f.dueAt)!) : null, reminders: f.reminders, website: f.website !== "app",
    scheduledAt: null, expiresAt: f.expiresAt ? new Date(fromIstInput(f.expiresAt)!) : null, pinnedUntil: null,
  });
  /** The same rules the server applies, so a person sees what is missing before a dialog opens. */
  const problems = (): Errors => {
    const cat = categories.find((c) => c.id === f.categoryId)?.name ?? null;
    const e = readyErrors(content(), { languages: f.lang2 ? [f.lang2] : [], categoryName: cat });
    if (cat?.toLowerCase() === NO_URGENT_CATEGORY && urgent) e.type = "An urgent alert cannot be about fees";
    if (f.response.kind !== "none" && !spec) e.response = "Finish the question, or choose Nothing to answer";
    if (f.dueAt && f.response.kind === "none") e.dueAt = "A last date needs something to answer";
    return e;
  };

  const begin = async (what: "send" | "schedule") => {
    if (readOnly) return;
    setBusy(true);
    try {
      const e = problems();
      if (Object.keys(e).length) { setErrors(e); toast("Fill in what is marked first.", "danger"); return; }
      if (!(await flush())) { toast("It could not be saved yet. Fix what is marked, then try again.", "danger"); return; }
      setDialog(what);
    } finally { setBusy(false); }
  };

  const go = async (run: (id: string) => Promise<{ ok: true; data?: unknown } | { ok: false; error: string; fieldErrors?: Errors }>, then: (noticeId: string) => string) => {
    setBusy(true);
    const noticeId = id.current!;
    const r = await run(noticeId).catch(() => ({ ok: false as const, error: "No connection. Nothing was sent.", fieldErrors: undefined }));
    setBusy(false);
    if (r.ok) { savedRev.current = rev.current; router.push(then(noticeId)); return; }
    setDialog(null);
    if (r.fieldErrors) setErrors(r.fieldErrors);
    toast(r.error, "danger");
  };
  const form = (noticeId: string, extra: Record<string, string> = {}) => { const fd = new FormData(); fd.set("id", noticeId); for (const [k, v] of Object.entries(extra)) fd.set(k, v); return fd; };
  const doSend = () => go((n) => (mode === "approval" ? submitNotice(form(n)) : publishNotice(form(n, { confirmed: urgent ? "1" : "0" }))), (n) => `/app/announcements/${n}`);
  const doSchedule = () => go(async (n) => {
    if (mode === "approval") { rev.current++; const r = await saveNotice(withSchedule(n)); return r.ok ? submitNotice(form(n)) : r; }
    const r = await scheduleNotice(form(n, { at: fromIstInput(scheduleAt) ?? "" }));
    if (r.ok && r.data.quietUntil) toast(`It goes at the end of quiet hours, ${istHm(new Date(r.data.quietUntil))}.`);
    return r;
  }, (n) => `/app/announcements/${n}`);
  const withSchedule = (n: string) => { const fd = new FormData(); fd.set("payload", JSON.stringify({ id: n, scheduledAt: fromIstInput(scheduleAt) })); return fd; };
  const doCorrect = async () => {
    const e = problems();
    if (Object.keys(e).length) { setErrors(e); toast("Fill in what is marked first.", "danger"); return; }
    const { id: _i, type: _t, ...edits } = payload(f, { id: id.current, correcting: true });
    const fd = new FormData();
    fd.set("id", id.current!); fd.set("payload", JSON.stringify(edits)); fd.set("note", note); fd.set("notifyAgain", notifyAgain ? "1" : "0");
    await go(async () => { const r = await correctNotice(fd); if (!r.ok && r.error === NEEDS_APPROVAL) setNeedsApproval(true); return r; }, (n) => `/app/announcements/${n}`);
  };
  const doSaveAsNew = async () => {
    const { id: _i, type: _t, ...edits } = payload(f, { id: id.current, correcting: true });
    const fd = new FormData();
    fd.set("id", id.current!); fd.set("payload", JSON.stringify(edits));
    setBusy(true);
    const r = await saveCorrectionAsNew(fd).catch(() => ({ ok: false as const, error: "No connection. Nothing was saved." }));
    setBusy(false);
    if (r.ok) { savedRev.current = rev.current; router.push(`/app/announcements/${r.data.id}/edit`); } else toast(r.error, "danger");
  };
  const saveAndClose = async () => {
    setBusy(true);
    const ok = await flush();
    setBusy(false);
    if (ok) router.push(id.current ? `/app/announcements/${id.current}` : "/app/announcements");
    else toast("It could not be saved yet. Your text is still here.", "danger");
  };

  const quietNote = (() => {
    const at = fromIstInput(scheduleAt);
    const until = at ? quietUntil(new Date(at), { from: quiet.from, to: quiet.to, sundays: quiet.sundays }) : null;
    return until ? `That time is inside quiet hours. People get the message at ${istHm(until)}.` : null;
  })();
  const primary = urgent ? "Send alert" : mode === "approval" ? "Send for approval" : "Publish";
  const second = f.lang2 && lang === "second";
  const previewFiles = files.map((x) => ({ name: x.name, size: x.size }));
  const cat = categories.find((c) => c.id === f.categoryId) ?? null;
  const websiteWhy = !may.website ? "You need the right to publish to put a notice on the website." : !publicAudience(f.audience) ? "Only a notice for everyone can go on the website. Choose Everyone above." : null;
  const statusText = readOnly ? "This school is read only" : correcting ? "A correction is saved when you press Save correction" : status.kind === "saving" ? "Saving" : status.kind === "saved" ? `Saved ${istHm(status.at)}` : status.kind === "failed" ? status.message : dirty ? "Not saved yet" : initial.id ? "All changes saved" : "Nothing written yet";

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      {readOnly ? <p role="status" className="rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-[var(--ds-color-warning-400)]">This school is in read only mode. You can read here, but nothing can be saved or sent until the school is open again. Ask the school admin.</p> : null}
      <div role="tablist" aria-label="Write or preview" className="flex gap-1 self-start rounded-full bg-white/[0.05] p-1 lg:hidden">
        {(["write", "preview"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("h-9 rounded-full px-4 text-sm", tab === t ? "bg-white/[0.12] font-medium text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{t === "write" ? "Write" : "Phone preview"}</button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className={cn("flex min-w-0 flex-col gap-4", tab === "preview" && "max-lg:hidden")}>
          <Section title="Who is it for">
            {onlyWebsite ? <p className="text-sm text-[var(--ds-on-surface-variant)]">No one is messaged. It goes on the school website only. Change that under Website below.</p> : (
              <div className="flex flex-col gap-2">
                <AudiencePicker name="audience" value={f.audience} onChange={(a) => set({ audience: a })} options={options} labels={labels} />
                {errors.audience ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.audience}</p> : null}
                {checkError && rev.current > 0 ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{checkError}</p> : null}
                {check?.mode === "approval" && may.publish ? <p className="text-sm text-[var(--ds-color-warning-400)]">This reaches beyond your own classes, so it goes for approval first{check.approvers.length ? ` to ${check.approvers.join(", ")}` : ""}.</p> : null}
              </div>
            )}
          </Section>

          <Section title="The notice">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Kind" error={errors.type} htmlFor="nf-type">
                <select id="nf-type" value={f.type} disabled={correcting} onChange={(e) => { const type = e.target.value as NoticeType; set({ type, ...(type === "urgent" ? { response: { kind: "ack" } } : {}) }); }} className={INPUT}>
                  {(["notice", "circular", ...(may.urgent || f.type === "urgent" ? ["urgent"] : [])] as NoticeType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </Row>
              <Row label="Category" error={errors.categoryId} htmlFor="nf-cat">
                <select id="nf-cat" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className={INPUT}>
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Row>
            </div>
            {f.type === "circular" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">A circular gets its number when it goes out, after the 30 seconds to undo, and a PDF on the school letterhead.</p> : null}
            {urgent ? <p className="text-xs text-[var(--ds-color-danger-400)]">An urgent alert reaches everyone on every channel at once, even at night. It cannot be undone or scheduled.</p> : null}
            {f.lang2 ? (
              <div role="tablist" aria-label="Language" className="flex gap-1 self-start rounded-full bg-white/[0.05] p-1">
                {([["main", "Main language"], ["second", f.lang2]] as const).map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={lang === k} onClick={() => setLang(k)} className={cn("h-8 rounded-full px-3 text-xs", lang === k ? "bg-white/[0.12] font-medium text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{label}</button>)}
              </div>
            ) : null}
            {!second ? (
              <>
                <Row label="Title" error={errors.title} htmlFor="nf-title"><input id="nf-title" value={f.title} maxLength={160} aria-invalid={!!errors.title || undefined} onChange={(e) => set({ title: e.target.value })} className={INPUT} /></Row>
                <MarkdownEditor key="main" name="body" label="Message" defaultValue={f.body} maxLength={10_000} rows={10} error={errors.body} onValueChange={(v) => set({ body: v })} />
              </>
            ) : (
              <>
                <Row label={`Title in ${f.lang2}`} error={errors.title2} htmlFor="nf-title2"><input id="nf-title2" value={f.title2} maxLength={160} onChange={(e) => set({ title2: e.target.value })} className={INPUT} /></Row>
                <MarkdownEditor key="second" name="body2" label={`Message in ${f.lang2}`} defaultValue={f.body2} maxLength={10_000} rows={10} error={errors.body2} onValueChange={(v) => set({ body2: v })} />
              </>
            )}
            {languages.length ? (
              f.lang2 ? <button type="button" className={cn(PILL_BTN, "self-start")} onClick={() => { set({ lang2: "", title2: "", body2: "" }); setLang("main"); }}>Remove the second language</button> : (
                <Row label="Second language" hint="Families who chose it see it with a switch. Nothing is translated for you." error={errors.lang2} htmlFor="nf-lang">
                  <select id="nf-lang" value="" onChange={(e) => { set({ lang2: e.target.value }); setLang("second"); }} className={INPUT}><option value="">Only the main language</option>{languages.map((l) => <option key={l} value={l}>{l}</option>)}</select>
                </Row>
              )
            ) : null}
          </Section>

          <Section title="Files">
            {!attachments ? <p className="text-sm text-[var(--ds-on-surface-muted)]">The school has turned attachments off.</p>
              : correcting ? <><FileList files={files.map((x) => ({ id: x.id, name: x.name, sizeBytes: x.size, type: x.contentType, href: `/api/notices/files/${x.id}` }))} /><p className="text-xs text-[var(--ds-on-surface-muted)]">Files cannot change in a correction. To change them, withdraw this and send a new notice.</p></>
              : (<><FilesField key={filesKey} label="Attachments" accept={["application/pdf", "image/*", ".docx", ".xlsx"]} maxCount={MAX_FILES} maxMb={15} existing={files.map((x) => ({ id: x.id, name: x.name, sizeBytes: x.size, type: x.contentType, href: `/api/notices/files/${x.id}` }))} disabled={readOnly} />
                {files.length > 1 && id.current ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-[var(--ds-on-surface)]">Order people see them in</span>
                    <ol className="flex flex-col gap-1">
                      {files.map((x, i) => (
                        <li key={x.id} className="flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.05] pl-3">
                          <span className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface)]">{i + 1}. {x.name}</span>
                          <button type="button" disabled={i === 0 || readOnly} onClick={() => void moveFile(i, -1)} aria-label={`Move ${x.name} up`} className={cn(PILL_BTN, "h-10 w-10 px-0")}><IconArrowUp className="h-4 w-4" aria-hidden /></button>
                          <button type="button" disabled={i === files.length - 1 || readOnly} onClick={() => void moveFile(i, 1)} aria-label={`Move ${x.name} down`} className={cn(PILL_BTN, "h-10 w-10 px-0")}><IconArrowDown className="h-4 w-4" aria-hidden /></button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}</>)}
          </Section>

          <Section title="What people must do">
            <ResponseBuilder value={urgent ? { kind: "ack" } : f.response} disabled={urgent} onChange={(response) => set({ response })} error={errors.response} />
            {urgent ? <p className="text-xs text-[var(--ds-on-surface-muted)]">People answer I am safe, or Received. You see the count live.</p> : null}
            {f.response.kind !== "none" ? (
              <div className="flex flex-col gap-3">
                <Row label="Answer by" hint="Answers can change until this time, then they are locked." error={errors.dueAt} htmlFor="nf-due"><input id="nf-due" type="datetime-local" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} className={INPUT} /></Row>
                {f.dueAt ? (
                  <fieldset className="flex flex-col gap-1"><legend className="mb-1 text-sm font-medium">Remind people who have not answered</legend>
                    {REMINDERS.map(([k, label]) => <label key={k} className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" className={box} checked={f.reminders[k]} onChange={(e) => set({ reminders: { ...f.reminders, [k]: e.target.checked } })} />{label}</label>)}
                  </fieldset>
                ) : null}
              </div>
            ) : null}
          </Section>

          <Section title="Keep it on top, and when it ends">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Pin until" hint="Stays at the top of the feed until then." error={errors.pinnedUntil} htmlFor="nf-pin"><input id="nf-pin" type="datetime-local" value={f.pinnedUntil} onChange={(e) => set({ pinnedUntil: e.target.value })} className={INPUT} /></Row>
              <Row label="Ends on" hint="After this it moves to the archive and stops asking for answers." error={errors.expiresAt} htmlFor="nf-end"><input id="nf-end" type="datetime-local" value={f.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} className={INPUT} /></Row>
            </div>
          </Section>

          <Section title="Website">
            <Row label="Where it shows" error={errors.website} htmlFor="nf-web" hint={websiteWhy ?? "Only on the school website, no one is messaged, if you choose Website only."}>
              <select id="nf-web" value={f.website} onChange={(e) => set({ website: e.target.value as WebsiteChoice })} className={INPUT}>
                <option value="app">In the app only</option>
                <option value="site" disabled={!!websiteWhy}>In the app and on the school website</option>
                <option value="only" disabled={!may.website}>On the school website only</option>
              </select>
            </Row>
            {f.website !== "app" && may.websiteApproval ? <p className="text-sm text-[var(--ds-color-warning-400)]">Putting a notice on the website needs approval, so it goes to an approver first.</p> : null}
            {f.website === "site" && !publicOk ? <p className="text-xs text-[var(--ds-color-danger-400)]">This notice is not for everyone, so it cannot go on the website.</p> : null}
          </Section>

          {correcting ? (
            <Section title="About this correction">
              <Row label="What changed" hint="People with the old version see this note." htmlFor="nf-note"><input id="nf-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={INPUT} /></Row>
              <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" className={box} checked={notifyAgain} onChange={(e) => setNotifyAgain(e.target.checked)} />Tell everyone again</label>
            </Section>
          ) : null}
        </div>

        <aside className={cn("min-w-0", tab === "write" && "max-lg:hidden")}>
          <div className="lg:sticky lg:top-4">
            <PhonePreview caption={f.lang2 ? `How families will see it (${second ? f.lang2 : "main language"})` : "How families will see it"}>
              <NoticeCard type={f.type} category={cat} number={f.type === "circular" ? "Number given when it goes out" : null} title={second ? f.title2 : f.title} body={second ? f.body2 : f.body} files={previewFiles} response={urgent ? { kind: "ack" } : f.response} dueAt={f.dueAt ? fromIstInput(f.dueAt) : null} />
            </PhonePreview>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 bg-[var(--ds-surface)]/95 px-4 py-3 backdrop-blur sm:-mx-0 sm:rounded-3xl">
        <p role="status" aria-live="polite" className={cn("min-w-0 flex-1 basis-40 text-sm", status.kind === "failed" ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]")}>
          {status.kind === "failed" ? <IconAlertTriangle className="mr-1 inline h-4 w-4" aria-hidden /> : null}{statusText}
          {status.kind === "failed" ? <> <button type="button" onClick={() => { nextTry.current = 0; void flush(); }} className="underline">Try again</button></> : null}
        </p>
        {correcting ? (
          <>
            <button type="button" className={PILL_BTN} onClick={() => router.push(`/app/announcements/${id.current}`)}>Cancel</button>
            {needsApproval ? <button type="button" className={PRIMARY_BTN} disabled={busy || readOnly} onClick={doSaveAsNew}>Save as a new notice for approval</button>
              : <button type="button" className={PRIMARY_BTN} disabled={busy || readOnly} onClick={doCorrect}>Save correction</button>}
          </>
        ) : (
          <>
            <button type="button" className={PILL_BTN} disabled={busy || readOnly} onClick={saveAndClose}>Save and close</button>
            {!urgent && !onlyWebsite ? <button type="button" className={PILL_BTN} disabled={busy || readOnly} onClick={() => begin("schedule")}>Schedule</button> : null}
            <button type="button" className={PRIMARY_BTN} disabled={busy || readOnly} onClick={() => begin("send")}>{primary}</button>
          </>
        )}
      </div>

      <Modal open={dialog === "send"} onOpenChange={(o) => !o && setDialog(null)} size="md" title={urgent ? "Send this alert now?" : mode === "approval" ? "Send for approval?" : "Publish this notice?"} description={f.title}
        footer={<ModalFooter secondary={{ onClick: () => setDialog(null), label: "Not yet" }} primary={{ label: urgent ? `Send to ${check?.people.total ?? "all"} now` : mode === "approval" ? "Send for approval" : onlyWebsite ? "Put on the website" : `Publish to ${check?.people.total ?? "all"}`, onClick: doSend, loading: busy, disabled: !onlyWebsite && (!check || check.people.total === 0) }} />}>
        <CheckSummary check={check} error={checkError} websiteOnly={onlyWebsite} mode={mode} urgent={urgent} content={content()} back={`/app/announcements/${id.current}/edit`} onChoose={() => setDialog(null)} />
      </Modal>

      <Modal open={dialog === "schedule"} onOpenChange={(o) => !o && setDialog(null)} size="sm" title="Schedule it"
        footer={<ModalFooter secondary={{ onClick: () => setDialog(null) }} primary={{ label: mode === "approval" ? "Schedule and send for approval" : "Schedule", onClick: doSchedule, loading: busy, disabled: !scheduleAt }} />}>
        <div className="flex flex-col gap-3 pt-2">
          <ModalField label="Send on" htmlFor="nf-at" hint={mode === "approval" ? "It goes out at this time once it is approved." : "India time. You can change or cancel it from the notice."}>
            <input id="nf-at" type="datetime-local" value={scheduleAt} min={new Date(Date.now() + 330 * 60_000 + 120_000).toISOString().slice(0, 16)} onChange={(e) => setScheduleAt(e.target.value)} className={INPUT} />
          </ModalField>
          {quietNote ? <p role="status" className="text-sm text-[var(--ds-color-warning-400)]">{quietNote}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

/** The small check before anything leaves: who it reaches, who it will not reach and why, what they must do. */
function CheckSummary({ check, error, websiteOnly, mode, urgent, content, back, onChoose }: { check: Check | null; error: string | null; websiteOnly: boolean; mode: "free" | "approval"; urgent: boolean; content: NoticeContent; back: string; onChoose: () => void }) {
  const asks = content.response.kind !== "none";
  const reach = check?.people;
  const skipped = reach?.unreachable ?? [];
  return (
    <div className="flex flex-col gap-4 pt-2 text-sm">
      <div>
        <h3 className="font-medium text-[var(--ds-on-surface)]">Who it reaches</h3>
        {websiteOnly ? <p className="text-[var(--ds-on-surface-variant)]">No one is messaged. It goes on the school website.</p>
          : error ? <p role="alert" className="text-[var(--ds-color-danger-400)]">{error}</p>
          : !reach ? <p className="text-[var(--ds-on-surface-muted)]">Counting people</p>
          : <>
              <p className="text-[var(--ds-on-surface-variant)]">{reach.total === 0 ? "Nobody." : [reach.families ? `${plural(reach.families, "family", "families")}` : "", reach.staff ? `${reach.staff} staff` : ""].filter(Boolean).join(" and ")}{reach.text ? `: ${reach.text}` : ""}</p>
              {reach.total === 0 ? (
                <p className="mt-2 flex flex-wrap gap-2">
                  {check && !check.school.students ? <Link href={`/app/students?next=${encodeURIComponent(back)}`} className={cn(PILL_BTN, "no-underline")}>Add students</Link> : null}
                  {check && !check.school.classes ? <Link href={`/app/academics/classes?next=${encodeURIComponent(back)}`} className={cn(PILL_BTN, "no-underline")}>Create classes</Link> : null}
                  {check && check.school.students && check.school.classes ? <button type="button" className={PILL_BTN} onClick={onChoose}>Choose other people</button> : null}
                </p>
              ) : null}
              {reach.sample.length ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{reach.sample.join(", ")}{reach.total > reach.sample.length ? " and others" : ""}</p> : null}
            </>}
      </div>
      {!websiteOnly && reach ? (
        <div>
          <h3 className="font-medium text-[var(--ds-on-surface)]">Who will not be reached</h3>
          {skipped.length ? (
            <>
              <p className="text-[var(--ds-on-surface-variant)]">{skipped.length}{skipped.length === 100 ? "+" : ""} people have no phone alerts and no email. They will see it when they open the app, and you can print a sign sheet for them.</p>
              <ul className="custom-scrollbar mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto">{skipped.slice(0, 8).map((u, i) => <li key={i} className="text-xs text-[var(--ds-on-surface-muted)]"><span className="text-[var(--ds-on-surface)]">{u.name}</span> {u.label}: {u.why}</li>)}</ul>
            </>
          ) : <p className="text-[var(--ds-on-surface-variant)]">Everyone has a way to be reached.</p>}
        </div>
      ) : null}
      <div>
        <h3 className="font-medium text-[var(--ds-on-surface)]">What they must do</h3>
        <p className="text-[var(--ds-on-surface-variant)]">{asks ? `${urgent ? "Say they are safe" : RESPONSE_WORDS[content.response.kind]}${content.dueAt ? `, by ${content.dueAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : ""}.` : "Nothing. It is for information."}</p>
      </div>
      {mode === "approval" && !urgent ? <p className="rounded-2xl bg-white/[0.05] px-4 py-3 text-[var(--ds-on-surface-variant)]">It does not go out yet. {check?.approvers.length ? `${check.approvers.join(", ")} will be asked to approve it.` : "An approver will be asked to approve it."} You can take it back until then.</p> : null}
      {mode === "free" && !urgent && !websiteOnly ? <p className="text-xs text-[var(--ds-on-surface-muted)]">After you publish there are 30 seconds to undo.</p> : null}
      {urgent ? <p className="rounded-2xl bg-[var(--ds-color-danger-500)]/10 px-4 py-3 text-[var(--ds-color-danger-400)]">This reaches {reach?.total ?? "everyone"} people on every channel at once, even at night. It cannot be undone.</p> : null}
    </div>
  );
}
