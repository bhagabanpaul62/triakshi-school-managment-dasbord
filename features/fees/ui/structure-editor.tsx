"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { FeeCalculator, rupees } from "../calculator";
import type { StructureView } from "../service";

type Item = { headId: string; amount: string };
type Inst = { id?: string; name: string; dueDate: string; amount: string };
const cents = (t: string) => Math.round(Number(t) * 100) || 0;
const asRupees = (p: number) => String(p / 100);

/** Create or edit a class's fee structure: fees, installments, late fee. The footer shows both totals so a mismatch is obvious before saving. */
export function StructureEditor({ classId, className, heads, structure, action }: {
  classId: string; className: string; heads: { id: string; name: string }[]; structure: StructureView | null; action: (fd: FormData) => Promise<FormResult>;
}) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rule = structure?.lateRules.find((r) => r.installmentId === null);
  const fresh = () => ({
    name: structure?.name ?? `${className} fees`,
    items: (structure?.items.map((i) => ({ headId: i.headId, amount: asRupees(i.amountPaise) })) ?? [{ headId: heads[0]?.id ?? "", amount: "" }]) as Item[],
    insts: (structure?.installments.map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amount: asRupees(i.amountPaise) })) ?? [{ name: "Term 1", dueDate: "", amount: "" }]) as Inst[],
    late: !!rule, kind: (rule?.kind ?? "per_day") as "flat" | "per_day", lateAmount: rule ? asRupees(rule.amountPaise) : "", grace: String(rule?.graceDays ?? 5), cap: rule?.maxPaise ? asRupees(rule.maxPaise) : "",
  });
  const [s, setS] = useState(fresh);
  const set = <K extends keyof ReturnType<typeof fresh>>(k: K, v: ReturnType<typeof fresh>[K]) => setS((x) => ({ ...x, [k]: v }));

  const feeTotal = s.items.reduce((t, i) => t + cents(i.amount), 0);
  const instTotal = s.insts.reduce((t, i) => t + cents(i.amount), 0);
  const balanced = feeTotal > 0 && feeTotal === instTotal;
  const diff = feeTotal - instTotal;
  // What still blocks Save, in the order the person would fix it; shown in the footer so the button is never a mystery.
  const problem = !s.name.trim() ? "Name the fee structure"
    : s.items.some((i) => !i.headId || cents(i.amount) <= 0) ? "Pick a fee and an amount in every fee row"
    : new Set(s.items.map((i) => i.headId)).size !== s.items.length ? "A fee is listed twice"
    : s.insts.some((i) => !i.name.trim() || !i.dueDate || cents(i.amount) <= 0) ? "Give every installment a name, due date and amount"
    : !balanced ? `Installments must add up to the fees (${rupees(Math.abs(diff))} ${diff > 0 ? "short" : "extra"})`
    : s.late && cents(s.lateAmount) <= 0 ? "Enter the late fee amount"
    : null;
  const fixLast = () => set("insts", s.insts.map((i, k) => (k === s.insts.length - 1 ? { ...i, amount: asRupees(Math.max(0, cents(i.amount) + diff)) } : i)));

  const splitEvenly = () => {
    const parts = FeeCalculator.apportion(feeTotal, s.insts.map(() => 1));
    set("insts", s.insts.map((i, k) => ({ ...i, amount: asRupees(parts[k]!) })));
  };

  const submit = () => start(async () => {
    // Per-installment late fees have no editor yet; carry them over so saving never drops them.
    const overrides = (structure?.lateRules ?? []).flatMap((r) => {
      const k = r.installmentId ? s.insts.findIndex((i) => i.id === r.installmentId) : -1;
      return k < 0 ? [] : [{ installmentIndex: k, kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise ?? undefined }];
    });
    const payload = {
      id: structure?.id, classId, name: s.name,
      items: s.items.map((i) => ({ headId: i.headId, amountPaise: cents(i.amount) })),
      installments: s.insts.map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate, amountPaise: cents(i.amount) })),
      lateRules: [
        ...(s.late ? [{ kind: s.kind, amountPaise: cents(s.lateAmount), graceDays: Number(s.grace) || 0, maxPaise: s.cap ? cents(s.cap) : undefined }] : []),
        ...overrides,
      ],
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    const r = await action(fd);
    if (r.ok) { setOpen(false); setErrors({}); toast(r.message ?? "Saved"); router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });

  return (
    <>
      <Button className="rounded-full" size="sm" variant={structure ? "secondary" : "default"} onClick={() => { setS(fresh()); setErrors({}); setOpen(true); }}>
        {structure ? "Edit" : "Set up fees"}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title={`${structure ? "Edit" : "Set up"} fees for ${className}`} dismissOnOutsideClick={false}
        icon={<IconChip className="h-10 w-10"><MenuIconView name="receipt" /></IconChip>}
        footer={<ModalFooter
          summary={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Fees {rupees(feeTotal)}</span><span>Installments {rupees(instTotal)}</span>
            {feeTotal || instTotal ? <ToneBadge tone={balanced ? "success" : "danger"} label={balanced ? "Matches" : `${rupees(Math.abs(diff))} ${diff > 0 ? "short" : "extra"}`} /> : null}
            {problem && (feeTotal || instTotal) && balanced ? <span className="text-[var(--ds-color-warning-300)]">{problem}</span> : null}
          </span>}
          secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Save fees", onClick: submit, loading: pending, disabled: !!problem }} />}>
        <div className="flex flex-col gap-6 pt-2">
          <ModalField label="Name" htmlFor={`${uid}-name`} required error={errors.name}>
            <input id={`${uid}-name`} value={s.name} onChange={(e) => set("name", e.target.value)} className={INPUT} />
          </ModalField>

          <ModalSection title="Fees for the year" description={errors.items}>
            <div className="flex flex-col gap-2">
              {s.items.map((it, k) => (
                <div key={k} className="grid grid-cols-[1fr_8rem_2.5rem] max-sm:grid-cols-[1fr_6.5rem_2.5rem] items-center gap-2">
                  <select aria-label={`Fee ${k + 1}`} value={it.headId} onChange={(e) => set("items", s.items.map((x, j) => (j === k ? { ...x, headId: e.target.value } : x)))} className={INPUT}>
                    <option value="">Choose a fee</option>
                    {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                  <input aria-label={`Fee ${k + 1} amount in rupees`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹" value={it.amount} onChange={(e) => set("items", s.items.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)))} className={INPUT} />
                  <button type="button" aria-label="Remove fee" title="Remove fee" disabled={s.items.length === 1} onClick={() => set("items", s.items.filter((_, j) => j !== k))}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-30"><span aria-hidden>×</span></button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="w-fit rounded-full" onClick={() => set("items", [...s.items, { headId: "", amount: "" }])}><span aria-hidden className="mr-1">+</span>Add a fee</Button>
            </div>
          </ModalSection>

          <ModalSection title="Installments" description={errors.installments ?? "When the money falls due. They must add up to the fees."}>
            <div className="flex flex-col gap-2">
              {s.insts.map((it, k) => (
                <div key={k} className="grid grid-cols-[1fr_9.5rem_8rem_2.5rem] max-sm:grid-cols-[1fr_1fr_2.5rem] max-sm:gap-y-2 items-center gap-2">
                  <input aria-label={`Installment ${k + 1} name`} value={it.name} onChange={(e) => set("insts", s.insts.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} className={`${INPUT} max-sm:col-span-3`} />
                  <input aria-label={`Installment ${k + 1} due date`} type="date" value={it.dueDate} onChange={(e) => set("insts", s.insts.map((x, j) => (j === k ? { ...x, dueDate: e.target.value } : x)))} className={INPUT} />
                  <input aria-label={`Installment ${k + 1} amount in rupees`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹" value={it.amount} onChange={(e) => set("insts", s.insts.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)))} className={INPUT} />
                  <button type="button" aria-label="Remove installment" title="Remove installment" disabled={s.insts.length === 1} onClick={() => set("insts", s.insts.filter((_, j) => j !== k))}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-30"><span aria-hidden>×</span></button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => set("insts", [...s.insts, { name: `Term ${s.insts.length + 1}`, dueDate: "", amount: "" }])}><span aria-hidden className="mr-1">+</span>Add installment</Button>
                <Button type="button" variant="ghost" size="sm" className="rounded-full" disabled={!feeTotal} onClick={splitEvenly}>Split the fees equally</Button>
                {feeTotal > 0 && !balanced && instTotal > 0 ? <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={fixLast}>Put the {rupees(Math.abs(diff))} difference on the last one</Button> : null}
              </div>
            </div>
          </ModalSection>

          <ModalSection title="Late fee" description={errors.lateRules}>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.late} onChange={(e) => set("late", e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Charge a late fee on every installment</label>
            {s.late ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <ModalField label="Type" htmlFor={`${uid}-kind`}>
                  <select id={`${uid}-kind`} value={s.kind} onChange={(e) => set("kind", e.target.value as "flat" | "per_day")} className={INPUT}>
                    <option value="per_day">Per day</option><option value="flat">One time</option>
                  </select>
                </ModalField>
                <ModalField label="Amount (₹)" htmlFor={`${uid}-late`}><input id={`${uid}-late`} type="number" min="0" step="0.01" value={s.lateAmount} onChange={(e) => set("lateAmount", e.target.value)} className={INPUT} /></ModalField>
                <ModalField label="Free days" htmlFor={`${uid}-grace`}><input id={`${uid}-grace`} type="number" min="0" value={s.grace} onChange={(e) => set("grace", e.target.value)} className={INPUT} /></ModalField>
                <ModalField label="Cap (₹)" htmlFor={`${uid}-cap`} hint="Optional"><input id={`${uid}-cap`} type="number" min="0" step="0.01" value={s.cap} onChange={(e) => set("cap", e.target.value)} className={INPUT} /></ModalField>
              </div>
            ) : null}
          </ModalSection>
        </div>
      </Modal>
    </>
  );
}
