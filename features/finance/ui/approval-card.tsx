"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { relative } from "@smw/ui/format";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

export interface ApprovalCardData {
  id: string;
  title: string;
  amountPaise: number;
  /** Said after the amount when it is not a total, like "a year per child". */
  unit?: string;
  reason: string;
  href: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requestedByName: string | null;
  decidedByName: string | null;
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  selfApproved: boolean;
  /** You asked for this yourself. */
  mine: boolean;
  /** Names this request waits for. */
  waitingFor: string[];
  /** The lines of a manual entry, so the approver reads what will post. */
  lines?: { code: string; account: string; debitPaise: number; creditPaise: number }[];
}

type Action = (fd: FormData) => Promise<FormResult>;

/** One decision: what, how much, why, who asked, and the two buttons. The note is for the maker; rejecting needs one. */
export function ApprovalCard({ a, approve, reject, withdraw, canDecide }: { a: ApprovalCardData; approve: Action; reject: Action; withdraw: Action; canDecide: boolean }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const decide = (action: Action, label: string) => start(async () => {
    const fd = new FormData();
    fd.set("id", a.id);
    if (note.trim()) fd.set("note", note.trim());
    const r = await action(fd);
    if (r.ok) { toast(label); router.refresh(); } else toast(r.error, "danger");
  });
  const open = a.status === "pending";
  const takeBack = () => start(async () => {
    const fd = new FormData();
    fd.set("id", a.id);
    const r = await withdraw(fd);
    if (r.ok) { toast("Request withdrawn"); router.refresh(); } else toast(r.error, "danger");
  });
  return (
    <article className="flex flex-col gap-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-5" aria-label={a.title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium">{a.href ? <Link href={a.href} className="hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{a.title}</Link> : a.title}</h3>
          <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">
            {a.requestedByName ?? "Someone"} asked {relative(a.createdAt)}
            {a.decidedAt ? ` · ${a.status === "approved" ? "approved" : "rejected"} by ${a.decidedByName ?? "someone"} ${relative(a.decidedAt)}${a.selfApproved ? " (own request, only admin)" : ""}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">{a.amountPaise ? <span className="flex items-baseline gap-1.5"><Money paise={a.amountPaise} size="lg" />{a.unit ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{a.unit}</span> : null}</span> : null}<StateBadge state={a.status} /></div>
      </header>
      <p className="text-sm text-[var(--ds-on-surface-variant)]">{a.reason}</p>
      {a.lines?.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">What will be posted</caption>
          <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><th className="py-1 font-normal">Account</th><th className="py-1 text-right font-normal">Debit</th><th className="py-1 text-right font-normal">Credit</th></tr></thead>
          <tbody>
            {a.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-3"><span className="text-[var(--ds-on-surface-muted)]">{l.code}</span> {l.account}</td>
                <td className="py-1.5 text-right"><Money paise={l.debitPaise || null} /></td>
                <td className="py-1.5 text-right"><Money paise={l.creditPaise || null} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {a.note ? <p className="rounded-2xl bg-white/[0.035] p-3 text-sm"><span className="text-[var(--ds-on-surface-muted)]">Note: </span>{a.note}</p> : null}
      {open ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{!a.mine ? "Waiting for you." : a.waitingFor.length ? `Waiting for ${a.waitingFor.join(", ")}.` : "Waiting for an admin. You are the only one, so approving it yourself needs a written reason."}</p> : null}
      {open && a.mine ? <div><Button type="button" variant="ghost" className="rounded-full" isLoading={pending} onClick={takeBack}>Withdraw request</Button></div> : null}
      {a.status === "rejected" && a.mine && a.href ? <p className="text-sm">Fix what was asked, then <Link href={a.href} className="underline">open the document</Link> and send it again.</p> : null}
      {open && canDecide ? (
        <div className="flex flex-col gap-3">
          
          <label className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">
            Note (needed to reject)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="rounded-full" isLoading={pending} onClick={() => decide(approve, "Approved")}>Approve</Button>
            <Button type="button" variant="secondary" className="rounded-full" disabled={pending || !note.trim()} onClick={() => decide(reject, "Rejected")}>Reject</Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
