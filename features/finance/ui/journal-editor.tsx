"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@smw/ui/ui/button";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

type Account = { id: string; code: string; name: string; group: string };
type Line = { accountId: string; debitPaise: number | null; creditPaise: number | null; costCentreId: string; key: number };
let seq = 0;
const blank = (): Line => ({ accountId: "", debitPaise: null, creditPaise: null, costCentreId: "", key: ++seq });

/** Two-sided lines with a live balance. The send button stays off until debits equal credits. */
export function JournalEditor({ accounts, centres, today, action, backTo }: { accounts: Account[]; centres: { id: string; name: string }[]; today: string; action: (fd: FormData) => Promise<FormResult>; backTo: string }) {
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [date, setDate] = useState(today), [memo, setMemo] = useState(""), [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const debit = lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0), credit = lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0);
  const filled = lines.filter((l) => l.accountId && ((l.debitPaise ?? 0) > 0) !== ((l.creditPaise ?? 0) > 0));
  const balanced = debit > 0 && debit === credit && filled.length === lines.length && memo.trim().length >= 3 && reason.trim().length >= 3;
  const groups = [...new Set(accounts.map((a) => a.group))];
  const name = (id: string) => accounts.find((a) => a.id === id);

  const send = () => start(async () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ date, memo, reason, lines: lines.map((l) => ({ accountId: l.accountId, debitPaise: l.debitPaise ?? 0, creditPaise: l.creditPaise ?? 0, costCentreId: l.costCentreId || undefined })) }));
    const r = await action(fd);
    if (r.ok) { toast(r.message ?? "Sent for approval"); router.push(backTo); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (balanced) send(); }} className="flex flex-col gap-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">Date<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={INPUT} aria-invalid={!!errors.date || undefined} /></label>
        <label className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)] sm:col-span-2">What is this entry for?<input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} className={INPUT} aria-invalid={!!errors.memo || undefined} /></label>
      </div>
      <ul className="flex flex-col gap-3" aria-label="Lines">
        {lines.map((l, i) => (
          <li key={l.key} className="grid gap-3 rounded-2xl bg-white/[0.035] p-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] sm:items-end">
            <label className="flex min-w-0 flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">Account {i + 1}
              <select value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} className={INPUT}>
                <option value="">Choose…</option>
                {groups.map((g) => <optgroup key={g} label={g}>{accounts.filter((a) => a.group === g).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</optgroup>)}
              </select>
            </label>
            <MoneyInput label="Debit" valuePaise={l.debitPaise} onChange={(p) => set(l.key, { debitPaise: p, ...(p ? { creditPaise: null } : {}) })} />
            <MoneyInput label="Credit" valuePaise={l.creditPaise} onChange={(p) => set(l.key, { creditPaise: p, ...(p ? { debitPaise: null } : {}) })} />
            <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08] disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><IconTrash className="h-4 w-4" aria-hidden /></button>
            {centres.length ? (
              <label className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)] sm:col-span-4">Cost centre (optional)
                <select value={l.costCentreId} onChange={(e) => set(l.key, { costCentreId: e.target.value })} className={INPUT}><option value="">None</option>{centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      <div><Button type="button" variant="ghost" className="rounded-full" onClick={() => setLines((ls) => [...ls, blank()])}><IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add a line</Button></div>

      <label className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">Why, for the approver<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={`${INPUT} h-auto py-2`} /></label>

      <section aria-live="polite" className="rounded-2xl bg-white/[0.035] p-4 text-sm">
        <p className="font-medium">What will post once approved</p>
        <ul className="mt-2 flex flex-col gap-1">
          {filled.map((l) => <li key={l.key} className="flex justify-between gap-3"><span>{l.debitPaise ? "Debit" : "Credit"} {name(l.accountId)?.name}</span><Money paise={l.debitPaise ?? l.creditPaise} /></li>)}
          {filled.length === 0 ? <li className="text-[var(--ds-on-surface-muted)]">Pick accounts and amounts above.</li> : null}
        </ul>
        <p className={`mt-3 flex flex-wrap justify-between gap-2 ${debit === credit && debit > 0 ? "text-[var(--ds-color-success-400)]" : "text-[var(--ds-color-warning-400)]"}`}>
          <span>{debit === credit && debit > 0 ? "Balanced" : "Debits and credits must be equal"}</span><span>Debit <Money paise={debit} /> · Credit <Money paise={credit} /></span>
        </p>
      </section>
      {errors.lines ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{errors.lines}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" className="rounded-full" isLoading={pending} disabled={!balanced}>Send for approval</Button>
        <Button type="button" variant="ghost" className="rounded-full" onClick={() => router.push(backTo)}>Cancel</Button>
      </div>
    </form>
  );
}
