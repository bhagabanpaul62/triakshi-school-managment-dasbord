"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { cn } from "@smw/ui/utils";
import { AmountSplit, type SplitMethod, type SplitPart } from "@smw/ui/finance/AmountSplit";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { collectReceipt, findStudents } from "../collect-actions";
import { changeDue, cashLimitWarning, dueNow, earliestDate, outcomeOf, pickedTotal, previewAllocation, selectIds, shareText, splitProblem, type DeskBill, type SelectMode } from "./logic";

export interface DeskMember { id: string; name: string; admissionNo: string; classLabel: string; tag?: string | null; advancePaise: number; waitingAdvancePaise: number; duePaise: number; overduePaise: number }
export interface DeskConfig { today: string; lateFeeFirst: boolean; cashLimitPaise: number; backdateDays: number; usesCounters: boolean; school: { name: string }; banks: { id: string; name: string }[] }
export interface DeskProps {
  config: DeskConfig;
  /** The picked student, or null before anyone is picked. */
  picked: { id: string; name: string } | null;
  members: DeskMember[];
  bills: DeskBill[];
  /** Your counter is open (or nobody has used counters yet, so cash needs none). */
  cashReady: boolean;
  openCounter: React.ReactNode;
}

const METHODS: SplitMethod[] = [{ key: "cash", label: "Cash" }, { key: "upi", label: "UPI" }, { key: "card", label: "Card" }, { key: "bank_transfer", label: "Bank transfer" }, { key: "cheque", label: "Cheque" }];
const LABELS: Record<string, string> = { upi: "UPI reference (UTR)", card: "Card slip number", bank_transfer: "Bank reference" };
interface Done { id: string; number: string; amountPaise: number; advancePaise: number; warnings: string[]; student: string }

/** The one-screen counter: find the family, tick the bills, split the money, collect. */
export function CollectDesk({ config, picked, members, bills, cashReady, openCounter }: DeskProps) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [payerId, setPayerId] = useState(picked?.id ?? "");
  const [sel, setSel] = useState<Record<string, number | null>>(() => Object.fromEntries(bills.filter((b) => b.studentId === picked?.id && b.state !== "upcoming").map((b) => [b.id, null])));
  const [custom, setCustom] = useState<number | null>(null);
  const [parts, setParts] = useState<SplitPart[] | null>(null);
  const [detail, setDetail] = useState<Record<string, { reference?: string; accountId?: string }>>({});
  const [cheque, setCheque] = useState({ chequeNo: "", bank: "", chequeDate: config.today });
  const [tendered, setTendered] = useState<number | null>(null);
  const [date, setDate] = useState(config.today);
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  // One id per time the desk opens: a double click or a retry sends it twice and still makes one receipt.
  const [requestId] = useState(() => crypto.randomUUID());
  const [keepExtra, setKeepExtra] = useState(false);

  const payer = members.find((m) => m.id === payerId) ?? members[0];
  const picks = Object.entries(sel).map(([id, limitPaise]) => ({ id, limitPaise }));
  const billsTotal = pickedTotal(bills, picks);
  const amount = custom ?? billsTotal;
  // With nothing ticked the server pays the payer's own open bills, so the preview shows the same.
  const effective = picks.length ? picks : bills.filter((b) => b.studentId === payer?.id).map((b) => ({ id: b.id, limitPaise: null as number | null }));
  const preview = previewAllocation(bills, effective, amount, config.lateFeeFirst);
  const methodParts: SplitPart[] = parts ?? (amount > 0 ? [{ method: cashReady ? "cash" : "upi", amountPaise: amount }] : []);
  const pickedBills = bills.filter((b) => effective.some((p) => p.id === b.id));
  // A slip of the finger (an extra zero) shows up as an advance larger than the bills themselves.
  const bigExtra = preview.leftoverPaise > 0 && preview.leftoverPaise >= Math.max(preview.appliedPaise, 100_000);
  const problem = splitProblem(methodParts, amount, payer?.advancePaise ?? 0, preview.leftoverPaise)
    ?? (bigExtra && !keepExtra ? "This is far more than the bills. Check the amount, or tick that the family really paid it." : null)
    ?? (methodParts.some((p) => p.method === "cash") && !cashReady ? "Open your counter before taking cash." : null)
    ?? (methodParts.some((p) => p.method === "cheque") && (!cheque.chequeNo.trim() || !cheque.bank.trim()) ? "Enter the cheque number and bank." : null);
  const outcome = outcomeOf({ totalPaise: amount, leftoverPaise: preview.leftoverPaise, picked: pickedBills, appliedPaise: preview.appliedPaise, parts: methodParts, payer: payer?.name ?? "The" });
  const cash = methodParts.find((p) => p.method === "cash")?.amountPaise ?? 0;
  const change = changeDue(cash, tendered);
  const warn = cashLimitWarning(cash, config.cashLimitPaise);
  const methods: SplitMethod[] = payer && payer.advancePaise > 0 ? [...METHODS, { key: "advance", label: "Advance", maxPaise: payer.advancePaise }] : METHODS;

  const choose = (ids: string[]) => { setSel(Object.fromEntries(ids.map((id) => [id, sel[id] ?? null]))); setCustom(null); setParts(null); };
  const toggle = (id: string) => choose(id in sel ? Object.keys(sel).filter((x) => x !== id) : [...Object.keys(sel), id]);
  const setLimit = (id: string, v: number | null) => { setSel({ ...sel, [id]: v }); setCustom(null); setParts(null); };
  const quick = (m: SelectMode) => choose(selectIds(bills, m));

  const submit = () => {
    if (problem || pending || !payer) { if (problem) setError(problem); return; }
    setError("");
    start(async () => {
      const limited = picks.filter((p) => p.limitPaise);
      const r = await collectReceipt({
        requestId, studentId: payer.id, date: date !== config.today ? date : undefined, payerName: payerName.trim() || undefined, note: note.trim() || undefined,
        invoiceIds: picks.filter((p) => !p.limitPaise).map((p) => p.id), parts: limited.map((p) => ({ invoiceId: p.id, amountPaise: p.limitPaise })),
        methods: methodParts.map((p) => ({
          method: p.method, amountPaise: p.amountPaise, reference: detail[p.method]?.reference?.trim() || undefined, cashAccountId: detail[p.method]?.accountId || undefined,
          cheque: p.method === "cheque" ? { chequeNo: cheque.chequeNo.trim(), bank: cheque.bank.trim(), chequeDate: cheque.chequeDate } : undefined,
        })),
      });
      if (!r.ok) { setError(r.error); toast(r.error, "danger"); return; }
      setDone({ ...r.data, student: payer.name });
      for (const w of r.data.warnings) toast(w);
    });
  };

  // Keys: Enter collects, P prints, N starts the next student. "/" is handled by the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox"));
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (done && !typing) {
        if (e.key.toLowerCase() === "p") { e.preventDefault(); window.open(`/app/fees/receipts/${done.id}/pdf`, "_blank"); }
        if (e.key.toLowerCase() === "n") { e.preventDefault(); router.push("/app/fees/collect"); }
      } else if (!done && e.key === "Enter" && (!t || t === document.body || (root.current?.contains(t) && !typing && t.tagName !== "BUTTON" && t.tagName !== "A"))) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const finder = (
    <RecordPicker name="student" label="Find a student" placeholder="Name, admission no, phone or bill no  ( / )" action={findStudents}
      initial={picked ? [{ id: picked.id, label: picked.name }] : []} onChange={(p) => router.push(p[0] ? `/app/fees/collect?student=${p[0].id}` : "/app/fees/collect")} />
  );

  if (done) return <SuccessCard done={done} school={config.school.name} />;

  return (
    <div ref={root} className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-3">
        <Panel title="Student">
          <div className="flex flex-col gap-4">
            {finder}
            {members.map((m) => (
              <label key={m.id} className={cn("flex cursor-pointer flex-col gap-1 rounded-2xl bg-white/[0.04] p-3 text-sm", m.id === payer?.id && "bg-white/[0.09]")}>
                <span className="flex items-center gap-2">
                  {members.length > 1 ? <input type="radio" name="payer" checked={m.id === payer?.id} onChange={() => { setPayerId(m.id); setParts(null); }} className="accent-[var(--ds-primary)]" /> : null}
                  <Link href={`/app/fees/students/${m.id}`} className="font-medium underline-offset-4 hover:underline">{m.name}</Link>
                </span>
                <span className="text-xs text-[var(--ds-on-surface-muted)]">{m.admissionNo} · {m.classLabel}{m.tag ? ` · ${m.tag}` : ""}</span>
                <span className="mt-1 grid grid-cols-3 gap-1 text-xs">
                  <span><span className="block text-[var(--ds-on-surface-muted)]">Due</span><Money paise={m.duePaise} size="sm" /></span>
                  <span><span className="block text-[var(--ds-on-surface-muted)]">Overdue</span><Money paise={m.overduePaise} size="sm" tone={m.overduePaise ? "danger" : "default"} /></span>
                  <span><span className="block text-[var(--ds-on-surface-muted)]">Advance</span><Money paise={m.advancePaise} size="sm" tone={m.advancePaise ? "success" : "default"} /></span>
                </span>
                {m.waitingAdvancePaise ? <span className="text-xs text-[var(--ds-on-surface-muted)]"><Money paise={m.waitingAdvancePaise} size="sm" /> more advance waits for a cheque to clear</span> : null}
              </label>
            ))}
            {members.length > 1 ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Brothers and sisters share one receipt. Pick who it is made out to.</p> : null}
          </div>
        </Panel>
      </div>

      <Panel title="Open bills" action={bills.length ? (
        <span className="flex flex-wrap gap-1 text-xs">
          {(["all", "overdue", "oldest", "none"] as const).map((m) => <button key={m} type="button" onClick={() => quick(m)} className="rounded-full bg-white/[0.07] px-3 py-1.5 hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{{ all: "Select all", overdue: "Overdue", oldest: "Oldest", none: "Clear" }[m]}</button>)}
        </span>
      ) : undefined}>
        {!picked ? (
          <p className="py-8 text-sm text-[var(--ds-on-surface-muted)]">Find a student to see what the family owes. You can search by name, admission number, a parent's phone or a bill number.</p>
        ) : !bills.length ? (
          <div className="flex flex-col items-start gap-2 py-6 text-sm">
            <p>Nothing is due for {picked.name}{members.length > 1 ? " or the brothers and sisters" : ""}.</p>
            <p className="text-[var(--ds-on-surface-muted)]">Money taken now is kept as an advance and used on the next bill.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((b) => {
              const on = b.id in sel;
              return (
                <li key={b.id} className={cn("grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-2xl p-3 text-sm", on ? "bg-white/[0.08]" : "bg-white/[0.035]")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(b.id)} aria-label={`Pay ${b.label} for ${b.studentName}`} className="mt-1 h-5 w-5 accent-[var(--ds-primary)]" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/fees/invoices/${b.id}`} className="font-medium underline-offset-4 hover:underline">{b.label}</Link>
                      <StateBadge state={b.state} />
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{members.length > 1 ? `${b.studentName} · ` : ""}{b.number ?? ""} · due {shortDate(b.dueDate)}{b.parts.length ? ` · in ${b.parts.length} parts` : ""}</p>
                    {b.accruedLatePaise > 0 ? <p className="mt-0.5 text-xs text-[var(--ds-color-warning-400)]">Late fee building up: <Money paise={b.accruedLatePaise} size="sm" /> (added when collected)</p> : null}
                    {on ? (
                      <div className="mt-2 max-w-48">
                        <MoneyInput label={`Pay on ${b.label}`} labelHidden valuePaise={sel[b.id] ?? null} max={dueNow(b)} onChange={(v) => setLimit(b.id, v)} hint="Blank pays it all" />
                        {preview.perBill[b.id] ? <p className="mt-1 text-xs text-[var(--ds-color-success-400)]">Clears <Money paise={preview.perBill[b.id]} size="sm" /></p> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right"><Money paise={dueNow(b)} size="md" tone={b.state === "overdue" ? "danger" : "default"} /><span className="block text-xs text-[var(--ds-on-surface-muted)]">open</span></div>
                </li>
              );
            })}
          </ul>
        )}
        {picked && preview.rows.length ? (
          <details open className="mt-4 rounded-2xl bg-white/[0.035] p-3 text-sm">
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--ds-on-surface-variant)]">What this clears, line by line</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {preview.rows.map((r, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{r.billLabel} · {r.line}</span><Money paise={r.amountPaise} size="sm" /></li>)}
            </ul>
          </details>
        ) : null}
      </Panel>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <Panel title="Take payment">
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
            {!cashReady ? <div className="rounded-2xl bg-white/[0.05] p-3 text-sm"><p className="text-[var(--ds-color-warning-400)]">Your counter is not open, so cash cannot be taken. UPI, card, bank transfer and cheque still work.</p><div className="mt-2">{openCounter}</div></div> : null}
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <MoneyInput label="Amount to take" valuePaise={amount || null} onChange={(v) => { setCustom(v ?? 0); setParts(null); }} hint={custom == null ? "Follows the ticked bills" : "Typed by you. Less than the bills pays the oldest first; more is kept as advance."} />
              </div>
              {custom != null ? <Button type="button" variant="ghost" className="rounded-full" onClick={() => { setCustom(null); setParts(null); }}>Use bills total</Button> : null}
            </div>
            <AmountSplit key={`${amount}-${payer?.id}`} totalPaise={amount} methods={methods} initial={{ [cashReady ? "cash" : "upi"]: amount }} onChange={(p) => setParts(p)} />
            {methodParts.map((p) => p.method === "cash" ? (
              <div key="cash" className="rounded-2xl bg-white/[0.04] p-3">
                <MoneyInput label="Cash given by the family" valuePaise={tendered} onChange={setTendered} hint="Optional. Shows the change to hand back." />
                {tendered != null ? <p className={cn("mt-2 text-sm", change.shortPaise ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-color-success-400)]")}>{change.shortPaise ? <>Short by <Money paise={change.shortPaise} size="sm" /></> : <>Return <Money paise={change.changePaise} size="sm" /> change</>}</p> : null}
              </div>
            ) : p.method === "cheque" ? (
              <fieldset key="cheque" className="grid gap-3 rounded-2xl bg-white/[0.04] p-3 sm:grid-cols-3">
                <legend className="px-1 text-[13px] text-[var(--ds-on-surface-variant)]">Cheque</legend>
                <Field label="Cheque no"><input className={INPUT} value={cheque.chequeNo} onChange={(e) => setCheque({ ...cheque, chequeNo: e.target.value })} inputMode="numeric" /></Field>
                <Field label="Bank"><input className={INPUT} value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} /></Field>
                <Field label="Cheque date"><input type="date" className={INPUT} value={cheque.chequeDate} onChange={(e) => setCheque({ ...cheque, chequeDate: e.target.value })} /></Field>
                <p className="text-xs text-[var(--ds-on-surface-muted)] sm:col-span-3">The bill stays open on the register until the cheque clears. A post-dated cheque is held until its date.</p>
              </fieldset>
            ) : p.method !== "advance" ? (
              <fieldset key={p.method} className="grid gap-3 rounded-2xl bg-white/[0.04] p-3 sm:grid-cols-2">
                <Field label={LABELS[p.method] ?? p.method}><input className={INPUT} value={detail[p.method]?.reference ?? ""} onChange={(e) => setDetail({ ...detail, [p.method]: { ...detail[p.method], reference: e.target.value } })} /></Field>
                {config.banks.length > 1 ? (
                  <Field label="Received in"><select className={INPUT} value={detail[p.method]?.accountId ?? ""} onChange={(e) => setDetail({ ...detail, [p.method]: { ...detail[p.method], accountId: e.target.value } })}>
                    <option value="">Default bank account</option>{config.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
                ) : null}
              </fieldset>
            ) : null)}
            {warn ? <p role="status" className="text-sm text-[var(--ds-color-warning-400)]">{warn}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date"><input type="date" className={INPUT} value={date} min={earliestDate(config.today, config.backdateDays)} max={config.today} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Received from"><input className={INPUT} value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Parent or guardian" /></Field>
              <Field label="Note" className="sm:col-span-2"><input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
            <section aria-label="What will happen" className="rounded-2xl bg-white/[0.05] p-4 text-sm">
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">What will happen</h3>
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Receipt</dt><dd><Money paise={outcome.receiptPaise} size="lg" /></dd></div>
                <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">Still due on these</dt><dd><Money paise={outcome.leftDuePaise} size="lg" tone={outcome.leftDuePaise ? "warning" : "success"} /></dd></div>
                <div><dt className="text-xs text-[var(--ds-on-surface-muted)]">New advance</dt><dd><Money paise={outcome.newAdvancePaise} size="lg" /></dd></div>
              </dl>
              <ul className="mt-3 list-disc pl-4 text-xs text-[var(--ds-on-surface-variant)]">{outcome.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
            {bigExtra ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keepExtra} onChange={(e) => setKeepExtra(e.target.checked)} className="h-5 w-5 accent-[var(--ds-primary)]" />The family paid this much. Keep <Money paise={preview.leftoverPaise} size="sm" /> as advance.</label> : null}
            {error || problem ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error || problem}{/counter/i.test(error) ? <> <Link href="/app/fees/counter" className="underline underline-offset-4">Go to the counter</Link></> : null}</p> : null}
            <Button type="submit" className="h-12 rounded-full text-base" isLoading={pending} disabled={!!problem || !payer}>Collect <Money paise={amount} size="md" className="ml-2" /></Button>
            <p className="text-center text-xs text-[var(--ds-on-surface-muted)]">Enter collects. / finds a student.</p>
          </form>
        </Panel>
      </div>
    </div>
  );
}

const Field = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={cn("flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]", className)}>{label}{children}</label>
);

function SuccessCard({ done, school }: { done: Done; school: string }) {
  const router = useRouter();
  const link = typeof window === "undefined" ? `/app/fees/receipts/${done.id}` : `${window.location.origin}/app/fees/receipts/${done.id}`;
  const text = shareText({ number: done.number, amountPaise: done.amountPaise, student: done.student, school, link });
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into WhatsApp or SMS."); } catch { toast("Could not copy. Open the receipt and copy the link.", "danger"); } };
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-3xl bg-[var(--ds-surface-container-low)] p-8 text-center" role="status">
      <p className="text-sm text-[var(--ds-color-success-400)]">Receipt made</p>
      <h2 className="font-mono text-4xl tracking-tight"><CopyValue value={done.number} label="receipt number" maxWidth="20ch" /></h2>
      <Money paise={done.amountPaise} size="xl" />
      <p className="text-sm text-[var(--ds-on-surface-variant)]">for {done.student}{done.advancePaise ? ` · ${(done.advancePaise / 100).toLocaleString("en-IN")} rupees kept as advance` : ""}</p>
      {done.warnings.map((w) => <p key={w} className="text-sm text-[var(--ds-color-warning-400)]">{w}</p>)}
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" className="rounded-full" onClick={() => window.open(`/app/fees/receipts/${done.id}/pdf`, "_blank")}>Print receipt (P)</Button>
        <Button type="button" variant="secondary" className="rounded-full" onClick={copy}>Copy message to share</Button>
        <Button type="button" variant="secondary" className="rounded-full" onClick={() => router.push("/app/fees/collect")}>Next student (N)</Button>
      </div>
      <p className="max-w-md text-xs text-[var(--ds-on-surface-muted)]">The first print is the original. Every print after that says DUPLICATE, and each one is logged.</p>
      <p className="text-sm text-[var(--ds-on-surface-muted)]">Made a mistake? <Link href={`/app/fees/receipts/${done.id}`} className="underline underline-offset-4">Open the receipt and ask for a reversal</Link>. Someone else approves it.</p>
    </div>
  );
}
