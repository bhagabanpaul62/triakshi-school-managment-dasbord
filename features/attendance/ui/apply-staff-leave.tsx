"use client";

import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { applyLeave, previewLeave } from "./actions";
import { fmtDays } from "../leave-days";
import type { Preview } from "../leave-balances";

export type StaffLeaveInitial = { typeId?: string; fromDate?: string; toDate?: string; halfDay?: string | null; reason?: string };
type Type = { id: string; name: string; halfDayAllowed: boolean };

/** Staff apply form: pick a type and dates and see the day count and the balance after, before sending. */
export function ApplyStaffLeave({ types, initial, label = "Apply for leave", variant = "default", notice }: { types: Type[]; initial?: StaffLeaveInitial; label?: string; variant?: "default" | "ghost"; notice?: ReactNode }) {
  const uid = useId(), router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ typeId: initial?.typeId ?? "", fromDate: initial?.fromDate ?? "", toDate: initial?.toDate ?? "", halfDay: initial?.halfDay ?? "" });
  const [split, setSplit] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value, ...(k === "fromDate" && !p.toDate ? { toDate: e.target.value } : {}) }));
  const type = types.find((t) => t.id === v.typeId);

  useEffect(() => {
    if (!open || !v.typeId || !v.fromDate || !v.toDate) { setPreview(null); setProblem(null); return; }
    const t = setTimeout(async () => {
      const fd = new FormData();
      for (const [k, x] of Object.entries(v)) fd.set(k, x);
      const r = await previewLeave(fd);
      if (r.ok) { setPreview(r.data as Preview); setProblem(null); } else { setPreview(null); setProblem(Object.values(r.fieldErrors ?? {})[0] ?? r.error); }
    }, 250);
    return () => clearTimeout(t);
  }, [open, v]);

  const submit = (fd: FormData) => start(async () => {
    fd.set("split", split ? "true" : "false");
    const r = await applyLeave(fd);
    if (r.ok) {
      setOpen(false); toast("Leave request sent");
      router.push(`/app/attendance/my-leave?new=${(r.data as { id: string }).id}`); router.refresh();
    } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });

  const days = (n: number) => `${fmtDays(n)} day${n === 2 ? "" : "s"}`;
  return (
    <>
      <Button onClick={() => { setErrors({}); setOpen(true); }} variant={variant} size={variant === "ghost" ? "sm" : "default"} className="rounded-full">{label}</Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title={label} dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Send request", type: "submit", form: `${uid}-f`, loading: pending }} />}>
        <form id={`${uid}-f`} onSubmit={keepValues(submit)} className="flex flex-col gap-5 pt-2" noValidate>
          {notice}
          <ModalSection>
            <div className="grid gap-4 sm:grid-cols-2">
              <ModalField label="Leave type" htmlFor={`${uid}t`} required error={errors.typeId} className="sm:col-span-2">
                <select id={`${uid}t`} name="typeId" value={v.typeId} onChange={set("typeId")} className={INPUT}>
                  <option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </ModalField>
              <ModalField label="First day" htmlFor={`${uid}a`} required error={errors.fromDate}><input id={`${uid}a`} name="fromDate" type="date" value={v.fromDate} onChange={set("fromDate")} className={INPUT} /></ModalField>
              <ModalField label="Last day" htmlFor={`${uid}b`} required error={errors.toDate}><input id={`${uid}b`} name="toDate" type="date" value={v.toDate} onChange={set("toDate")} className={INPUT} /></ModalField>
              {type?.halfDayAllowed && v.fromDate && v.fromDate === v.toDate ? (
                <ModalField label="Half day" htmlFor={`${uid}h`} error={errors.halfDay} className="sm:col-span-2">
                  <select id={`${uid}h`} name="halfDay" value={v.halfDay} onChange={set("halfDay")} className={INPUT}>
                    <option value="">Whole day</option><option value="first">First half</option><option value="second">Second half</option>
                  </select>
                </ModalField>
              ) : null}
              <ModalField label="Reason" htmlFor={`${uid}r`} required error={errors.reason} className="sm:col-span-2"><textarea id={`${uid}r`} name="reason" rows={3} defaultValue={initial?.reason} className={`${INPUT} h-auto py-2`} /></ModalField>
              <ModalField label={preview?.needsFile ? "Note or document (needed)" : "Note or document (optional)"} htmlFor={`${uid}f`} error={errors.file} className="sm:col-span-2">
                <input id={`${uid}f`} name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className={INPUT} />
              </ModalField>
            </div>
          </ModalSection>
          <div aria-live="polite" className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">
            {problem ? <span className="text-[var(--ds-color-danger-500)]">{problem}</span> : !preview ? "Pick a type and the dates to see how many days this takes." : (
              <>
                <p className="text-[var(--ds-on-surface)]">{preview.workingDays} working day{preview.workingDays === 1 ? "" : "s"} ({days(preview.halfDays)}). Sundays and holidays are not counted.</p>
                {preview.paid ? <p className="mt-1">{preview.typeName}: {fmtDays(preview.left)} left{preview.pending ? `, ${fmtDays(preview.pending)} waiting for approval` : ""}. After this: {fmtDays(Math.max(preview.after, 0))}.</p> : <p className="mt-1">Unpaid leave: the days are cut from salary.</p>}
                {preview.short > 0 ? (
                  preview.unpaidTypeName ? (
                    <label className="mt-2 flex items-start gap-2 text-[var(--ds-on-surface)]">
                      <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--ds-primary)]" />
                      <span>Not enough {preview.typeName}. Send {days(preview.paidHalfDays)} as {preview.typeName} and the other {days(preview.unpaidHalfDays)} as {preview.unpaidTypeName} (unpaid).</span>
                    </label>
                  ) : <p className="mt-2 text-[var(--ds-color-danger-500)]">Not enough {preview.typeName} and the school has no unpaid leave type. Ask the admin to add one under Leave types.</p>
                ) : null}
                {errors.split ? <p className="mt-2 text-[var(--ds-color-danger-500)]">{errors.split}</p> : null}
              </>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
