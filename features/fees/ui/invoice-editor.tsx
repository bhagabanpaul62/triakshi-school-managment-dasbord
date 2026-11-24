"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import type { DocumentConfig } from "@smw/ui/finance/document-types";
import { LineItemsEditor, type Line } from "@smw/ui/finance/LineItemsEditor";
import { Money } from "@smw/ui/finance/Money";
import { RecordPicker, type PickerOption } from "@smw/ui/finance/RecordPicker";
import { applyHidden } from "@smw/feature-finance/templates/config";
import { chargeGroup, deleteInvoiceDraft, findStudents, groupOf, issueInvoice, resubmitInvoiceChange, reviseInvoice, saveInvoice } from "./actions";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { invoicePaperData, paperConfig, reviseDifference } from "./logic";
import { CARD, H3, LINK, MUTED } from "./styles";

type Config = DocumentConfig & { hiddenFacts: string[]; hiddenTotals: string[] };
interface ClassChoice { id: string; name: string; sections: { id: string; name: string }[] }
export interface InvoiceEditorProps {
  mode: "new" | "edit" | "revise";
  heads: { id: string; label: string }[];
  config: Config;
  today: string;
  classes: ClassChoice[];
  student?: PickerOption;
  invoice?: { id: string; number: string | null; label: string; dueDate: string; note: string | null; lines: { headId: string | null; label: string; amountPaise: number; kind: string }[] };
  /** The bill being revised: what it held before, and the refused request this edit sends again, if any. */
  revise?: { oldLines: { label: string; amountPaise: number; concessionPaise: number; creditedPaise: number; paidPaise: number }[]; changeId?: string; reason?: string };
  canGroup: boolean;
}

const LAYOUTS = [{ value: "a4", label: "A4" }, { value: "a5", label: "A5" }, { value: "two_up", label: "Two on A4" }, { value: "thermal80", label: "80 mm" }] as const;
const KINDS = [{ value: "fee", label: "Fee" }, { value: "deposit", label: "Refundable deposit" }];
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const field = "flex flex-col gap-1.5 text-sm";

/**
 * THE INVOICE EDITOR. Left: who, what for, the lines. Right: the bill as it will print, updating as you type, the
 * totals, and for a revision what changes and whether it needs a second person. A new or edited draft saves itself.
 */
export function InvoiceEditor({ mode, heads, config, today, classes, student, invoice, revise, canGroup }: InvoiceEditorProps) {
  const router = useRouter(), path = usePathname();
  const [who, setWho] = useState<"one" | "class">("one");
  const [picked, setPicked] = useState<PickerOption | undefined>(student);
  const [classId, setClassId] = useState(""), [sectionId, setSectionId] = useState("");
  const [group, setGroup] = useState<{ id: string; name: string }[] | null>(null);
  const [label, setLabel] = useState(invoice?.label ?? "");
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [note, setNote] = useState(invoice?.note ?? "");
  const [reason, setReason] = useState(revise?.reason ?? "");
  const [layout, setLayout] = useState<DocumentConfig["layout"]>(config.layout);
  const headOptions = useMemo(() => [...heads, { id: "", label: "No fee head" }], [heads]);
  const [lines, setLines] = useState<Line[]>(() => invoice?.lines.length ? invoice.lines.map((l) => ({ id: uid(), headId: l.headId ?? "", label: l.label, amountPaise: l.amountPaise, kind: l.kind === "deposit" ? "deposit" : "fee" })) : [{ id: uid(), headId: heads[0]?.id ?? "", label: "", amountPaise: 0, kind: "fee" }]);
  const [draftId, setDraftId] = useState(mode === "edit" ? invoice?.id : undefined);
  const [error, setError] = useState(""), [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string>("");
  const [pending, start] = useTransition();
  const savedSig = useRef<string>("");

  const body = useMemo(() => lines.filter((l) => l.amountPaise > 0).map((l) => ({ headId: l.headId || undefined, kind: l.kind, label: l.label.trim() || heads.find((h) => h.id === l.headId)?.label || "Charge", amountPaise: l.amountPaise })), [lines, heads]);
  const sig = JSON.stringify([picked?.id, label, dueDate, note, body, reason]);
  if (!savedSig.current) savedSig.current = sig;
  const dirty = sig !== savedSig.current;
  const total = body.reduce((s, l) => s + l.amountPaise, 0);
  const groupMode = who === "class" && mode === "new";
  const diff = revise ? reviseDifference(revise.oldLines, body) : null;

  // The preview: the bill as it will print, from what is typed now.
  const paper = useMemo(() => { const parts = (picked?.meta ?? "").split(" · "); return applyHidden(config, invoicePaperData({
    number: mode === "revise" ? null : invoice?.number ?? null, issueDate: null, dueDate, label, note: note || null, marks: [],
    student: picked ? { name: picked.label, admissionNo: parts[0] ?? "", classLabel: parts[1] ?? "", guardian: null } : groupMode ? { name: group ? `${group.length} students` : "A whole class", admissionNo: "-", classLabel: classes.find((c) => c.id === classId)?.name ?? "-", guardian: null } : null,
    lines: body.map((l) => ({ label: l.label, amountPaise: l.amountPaise, concessionPaise: 0 })),
  })); }, [config, mode, invoice?.number, dueDate, label, note, picked, groupMode, group, classes, classId, body]);
  const shown = useMemo(() => paperConfig({ ...config, watermark: mode === "revise" ? config.watermark : "DRAFT" }, layout), [config, layout, mode]);

  const payload = useCallback(() => ({ id: draftId, studentId: picked?.id, label, dueDate, note: note || undefined, lines: body }), [draftId, picked, label, dueDate, note, body]);
  const ready = (groupMode ? !!group?.length : !!picked) && label.trim().length >= 2 && !!dueDate && body.length > 0 && body.length === lines.filter((l) => l.amountPaise > 0).length;

  /** Save the draft. Returns its id, or null when something is wrong (the screen then says what). */
  const saveDraft = useCallback(async (quiet = false): Promise<string | null> => {
    if (!ready || groupMode) { if (!quiet) setError(groupMode ? "A bill for a class is issued straight away, there is no draft." : "Pick the student, name the bill, set the due date and give every line an amount."); return null; }
    const now = sig;
    const r = await saveInvoice(JSON.stringify(payload()));
    if (!r.ok) { setSaved(""); if (!quiet) { setError(r.error); setErrors(r.fieldErrors ?? {}); } else setSaved(`Not saved: ${r.error}`); return null; }
    savedSig.current = now; setDraftId(r.data.id); setError(""); setErrors({});
    setSaved(`Draft saved ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`);
    if (!draftId) window.history.replaceState(null, "", `/app/fees/invoices/${r.data.id}/edit`);
    return r.data.id;
  }, [ready, groupMode, sig, payload, draftId]);

  // Autosave a new or edited draft a moment after the typing stops.
  const latest = useRef(saveDraft);
  latest.current = saveDraft;
  useEffect(() => {
    if (mode === "revise" || groupMode || !dirty || !ready) return;
    const t = setTimeout(() => { void latest.current(true); }, 1800);
    return () => clearTimeout(t);
  }, [sig, mode, groupMode, dirty, ready]);

  useUnsavedGuard(dirty);

  useEffect(() => {
    if (!classId) { setGroup(null); return; }
    let live = true;
    void groupOf(classId, sectionId).then((r) => { if (live) setGroup(r.ok ? r.data : []); });
    return () => { live = false; };
  }, [classId, sectionId]);

  const issue = () => start(async () => {
    setError("");
    if (mode === "revise") {
      if (reason.trim().length < 3) { setError("Say why the bill is being revised."); return; }
      const o = { id: invoice!.id, changeId: revise?.changeId, reason, label: label.trim() || undefined, dueDate: dueDate || undefined, lines: body };
      if (!body.length) { setError("Add at least one line with an amount."); return; }
      const r = await (revise?.changeId ? resubmitInvoiceChange(JSON.stringify(o)) : reviseInvoice(JSON.stringify(o)));
      if (!r.ok) { setError(r.error); setErrors(r.fieldErrors ?? {}); return; }
      const d = r.data as { requested?: boolean; invoiceId?: string | null } | undefined;
      savedSig.current = sig; toast(d?.requested ? "Sent for approval. The bill stays as it is until then." : "Revised: the new version is issued");
      router.push(`/app/fees/invoices/${d?.requested || !d?.invoiceId ? invoice!.id : d.invoiceId}`);
      return;
    }
    if (groupMode) {
      if (!ready || !group) { setError("Pick the class, name the bill, set the due date and give every line an amount."); return; }
      const r = await chargeGroup(JSON.stringify({ studentIds: group.map((g) => g.id), label, dueDate, note: note || undefined, lines: body }));
      if (!r.ok) { setError(r.error); setErrors(r.fieldErrors ?? {}); return; }
      savedSig.current = sig; toast(`${r.data.count} bills issued`); router.push("/app/fees/invoices?kind=custom"); return;
    }
    const id = await saveDraft();
    if (!id) return;
    const fd = new FormData(); fd.set("id", id);
    const r = await issueInvoice(fd);
    if (!r.ok) { setError(r.error); return; }
    savedSig.current = sig; toast("Bill issued"); router.push(`/app/fees/invoices/${id}`);
  });
  const draft = () => start(async () => { const id = await saveDraft(); if (id) { toast("Draft saved"); router.push(`/app/fees/invoices/${id}`); } });
  const discard = () => start(async () => {
    if (draftId) { const fd = new FormData(); fd.set("id", draftId); await deleteInvoiceDraft(fd); }
    savedSig.current = sig; router.push("/app/fees/invoices");
  });

  // Cmd or Ctrl + S saves the draft, + Enter issues.
  const keys = useRef({ issue, draft });
  keys.current = { issue, draft };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s" && mode !== "revise" && !groupMode) { e.preventDefault(); keys.current.draft(); }
      if (e.key === "Enter") { e.preventDefault(); keys.current.issue(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [mode, groupMode]);

  const back = mode === "new" ? "/app/fees/invoices" : `/app/fees/invoices/${invoice!.id}`;
  const primary = mode === "revise" ? (diff?.needsApproval ? "Send for approval" : "Revise and issue") : groupMode ? `Issue ${group?.length ?? ""} bills`.replace("  ", " ") : "Issue bill";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <div className="flex min-w-0 flex-col gap-5">
        <section className={`${CARD} flex flex-col gap-5`} aria-label="Who and what for">
          {mode === "new" && canGroup ? <SegmentedControl label="Bill for" size="sm" value={who} onChange={setWho} options={[{ value: "one", label: "One student" }, { value: "class", label: "A whole class" }]} /> : null}
          {mode === "revise" ? <p className="text-sm">Revising <b>{invoice!.number}</b> for <b>{picked?.label}</b>. The lines below start as what is still open on the bill.</p>
            : groupMode ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={field}>Class<select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); }} className={INPUT}><option value="">Choose a class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className={field}>Section<select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={INPUT} disabled={!classId}><option value="">All sections</option>{classes.find((c) => c.id === classId)?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <p className={`${MUTED} sm:col-span-2`}>{!classId ? "Pick a class. Every active student in it gets this bill, issued at once." : group ? `${group.length} active student${group.length === 1 ? "" : "s"} will each get this bill.${group.length === 0 ? " Pick another class or section." : ""}` : "Counting students..."}</p>
              </div>
            ) : (
              <>
                <RecordPicker action={findStudents} name="studentId" label="Student" required initial={student ? [student] : []} onChange={(p) => setPicked(p[0])} placeholder="Name or admission number, press / to jump here" error={errors.studentId} />
                {mode === "new" ? <p className={`${MUTED} -mt-3`}>Not sure who? Open <Link href="/app/fees/dues" className={LINK}>the dues list</Link>, or bill a whole class with the switch above.</p> : null}
              </>
            )}
          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <label className={field}>Bill for<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="School trip, Lab fee, Duplicate ID card" className={INPUT} aria-invalid={errors.label ? true : undefined} />{errors.label ? <span role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.label}</span> : null}</label>
            <label className={field}>Due date<input type="date" value={dueDate} min={mode === "new" ? today : undefined} onChange={(e) => setDueDate(e.target.value)} className={INPUT} aria-invalid={errors.dueDate ? true : undefined} />{errors.dueDate ? <span role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.dueDate}</span> : null}</label>
          </div>
          <label className={field}>Note on the bill (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className={`${INPUT} h-auto py-2`} /></label>
        </section>

        <section className={CARD} aria-label="Lines">
          <h2 className={H3}>What is being billed</h2>
          {heads.length ? null : <p className={`${MUTED} mb-3`}>No fee heads yet, so lines go without one. <Link href={`/app/fees/heads?next=${encodeURIComponent(back)}`} className={LINK}>Add fee heads</Link> to report income by fee.</p>}
          <LineItemsEditor heads={headOptions} lines={lines} onChange={setLines} kinds={KINDS} errors={errors} totalLabel="Bill total" />
          {errors.lines ? <p role="alert" className="mt-2 text-xs text-[var(--ds-color-danger-400)]">{errors.lines}</p> : null}
          {mode !== "revise" ? <p className={`${MUTED} mt-3`}>Discounts the student is entitled to are applied to bills made from fee plans. For an extra charge, take money off with a credit note after issuing.</p> : null}
        </section>

        {mode === "revise" ? (
          <section className={CARD} aria-label="Why">
            <label className={field}>Why is it being revised?<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={`${INPUT} h-auto py-2`} aria-invalid={errors.reason ? true : undefined} />{errors.reason ? <span role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.reason}</span> : null}</label>
            <h3 className="mb-2 mt-5 text-sm font-medium">The bill now</h3>
            <ul className="divide-y divide-white/[0.06] text-sm">
              {revise!.oldLines.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{l.label}</span>
                  <span className={`${MUTED} flex flex-wrap items-center gap-3`}>{l.concessionPaise ? <span>Concession <Money paise={l.concessionPaise} size="sm" /></span> : null}{l.creditedPaise ? <span>Credit <Money paise={l.creditedPaise} size="sm" /></span> : null}{l.paidPaise ? <span>Paid <Money paise={l.paidPaise} size="sm" /></span> : null}<Money paise={l.amountPaise} /></span></li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside aria-label="Preview and totals" className="flex h-fit min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <div className={`${CARD} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl label="Paper" size="sm" value={layout} onChange={setLayout} options={LAYOUTS} />
            <Link href={`/app/finance/templates?next=${encodeURIComponent(path)}`} className="text-xs underline underline-offset-4">Customise layout</Link>
          </div>
          <DocumentPaper config={shown} data={paper} kind="invoice" />
          <p className={MUTED}>Preview only. The number and date are given when the bill is issued.</p>
        </div>

        <div className={`${CARD} flex flex-col gap-3`}>
          {diff ? (
            <div aria-label="What changes" className="flex flex-col gap-1 text-sm">
              <h2 className={H3}>What changes</h2>
              <div className="flex justify-between"><span className="text-[var(--ds-on-surface-muted)]">Open on the bill now</span><Money paise={diff.oldOpenPaise} /></div>
              <div className="flex justify-between"><span className="text-[var(--ds-on-surface-muted)]">After the revision</span><Money paise={diff.newPaise} /></div>
              <div className="flex justify-between font-medium"><span>Difference</span><Money paise={diff.differencePaise} sign="always" tone={diff.differencePaise < 0 ? "success" : diff.differencePaise > 0 ? "warning" : "default"} /></div>
              <p className={diff.needsApproval ? "text-[var(--ds-color-warning-400)]" : MUTED}>{diff.why}</p>
            </div>
          ) : <div className="flex items-baseline justify-between text-sm"><span>{groupMode && group?.length ? `Each of ${group.length} students pays` : "Bill total"}</span><Money paise={total} size="xl" /></div>}
          {groupMode && group?.length ? <p className={MUTED}>{group.length} bills, {`₹${((total * group.length) / 100).toLocaleString("en-IN")}`} in all.</p> : null}
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
          <div className="flex flex-col gap-2">
            <Button type="button" className="rounded-full" isLoading={pending} onClick={issue}>{primary}<kbd className="ml-2 hidden rounded bg-black/20 px-1.5 text-[10px] sm:inline">Ctrl Enter</kbd></Button>
            {mode !== "revise" && !groupMode ? <Button type="button" variant="secondary" className="rounded-full" disabled={pending} onClick={draft}>Save as draft<kbd className="ml-2 hidden rounded bg-white/10 px-1.5 text-[10px] sm:inline">Ctrl S</kbd></Button> : null}
            <div className="flex items-center justify-between gap-3 pt-1 text-sm">
              <Link href={back} className="py-2 text-[var(--ds-on-surface-muted)] underline underline-offset-4">Cancel</Link>
              {mode !== "revise" && (draftId || dirty) ? <button type="button" onClick={discard} className="py-2 text-[var(--ds-on-surface-muted)] underline underline-offset-4">Discard draft</button> : null}
            </div>
            <p role="status" aria-live="polite" className={MUTED}>{saved || (dirty && mode !== "revise" && !groupMode ? "Not saved yet. It saves itself when you pause typing." : "")}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
