"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { cn } from "../lib/utils";
import { INPUT } from "../lib/tone";
import { redrawImage } from "../lib/redraw-image";
import { Modal, ModalField, ModalFooter, ModalSection } from "../components/dashboard/kit/Modal";
import { IconChip } from "../components/dashboard/kit/Panel";
import { Button } from "../components/ui/button";
import { toast } from "./toast";
import { MenuIconView } from "./icons";

/** What every server action returns (same shape as @smw/runtime ActionResult). */
/**
 * `<form onSubmit={keepValues(submit)}>` in place of `action={submit}`: React resets a form after every `action`,
 * so a server-side "no" (wrong password, a field error) wiped everything the person typed. This sends the same
 * FormData without that reset; `submit` gets `reset` to call on success when the form should clear.
 */
export const keepValues = (submit: (fd: FormData, reset: () => void) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const form = e.currentTarget;
  submit(new FormData(form, (e.nativeEvent as SubmitEvent).submitter), () => form.reset());
};

export type FormResult = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

/** One form field, as plain data, so server pages can describe forms. */
export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "date" | "time" | "datetime-local" | "password" | "textarea" | "select" | "checkbox" | "money" | "file" | "color" | "multiselect";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** Both columns on wide modals. */
  wide?: boolean;
  section?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  accept?: string;
  /** File fields: re-encode any image that is not JPEG or PNG (WebP, HEIC the browser can read) to JPEG before upload, so PDFs can print it. */
  asJpeg?: boolean;
};

/** Swap the input's file for a JPEG (longest side at most 1200 px) unless it is JPEG or PNG already. Unreadable files stay as they are. */
async function reencodeAsJpeg(input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file || !file.type.startsWith("image/") || file.type === "image/jpeg" || file.type === "image/png") return;
  const jpeg = await redrawImage(file, 1200);
  if (!jpeg) return; // the browser cannot read it: upload the original, the server decides
  const dt = new DataTransfer();
  dt.items.add(jpeg);
  input.files = dt.files;
}

export { INPUT } from "../lib/tone";

function Control({ f, id, value, invalid }: { f: Field; id: string; value: unknown; invalid: boolean }) {
  const common = { id, name: f.name, required: f.required, "aria-invalid": invalid || undefined, placeholder: f.placeholder };
  const v = value == null ? undefined : String(value);
  switch (f.type) {
    case "textarea": return <textarea {...common} defaultValue={v} rows={4} className={cn(INPUT, "h-auto py-2")} />;
    case "select": return (
      <select {...common} defaultValue={v ?? ""} className={INPUT}>
        <option value="">{f.required ? "Choose…" : "None"}</option>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
    case "multiselect": {
      const chosen = new Set(Array.isArray(value) ? value.map(String) : v ? [v] : []);
      return (
        <div className="flex flex-wrap gap-2">
          {f.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-[var(--ds-color-primary-500)]/20">
              <input type="checkbox" name={f.name} value={o.value} defaultChecked={chosen.has(o.value)} className="accent-[var(--ds-primary)]" />{o.label}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox": return (
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" id={id} name={f.name} value="true" defaultChecked={value === true || value === "true"} className="h-4 w-4 accent-[var(--ds-primary)]" />{f.placeholder ?? "Yes"}</label>
    );
    case "money": return <input {...common} type="number" step="0.01" min="0" defaultValue={value == null ? undefined : Number(value) / 100} className={INPUT} />;
    case "file": return <input id={id} name={f.name} type="file" accept={f.accept} required={f.required} onChange={f.asJpeg ? (e) => void reencodeAsJpeg(e.currentTarget) : undefined} className={INPUT} />;
    default: return <input {...common} type={f.type ?? "text"} min={f.min} max={f.max} step={f.step} defaultValue={v?.slice(0, f.type === "date" ? 10 : undefined)} className={INPUT} />;
  }
}

/** The field grid used by FormModal and by full-page forms. */
export function FieldGrid({ fields, values = {}, errors = {}, columns = 2 }: { fields: Field[]; values?: Record<string, unknown>; errors?: Record<string, string>; columns?: 1 | 2 }) {
  const uid = useId();
  const sections = [...new Set(fields.map((f) => f.section ?? ""))];
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <ModalSection key={s || "main"} title={s || undefined}>
          <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
            {fields.filter((f) => (f.section ?? "") === s).map((f) => (
              <ModalField key={f.name} label={f.label} htmlFor={`${uid}-${f.name}`} required={f.required} hint={f.hint} error={errors[f.name]}
                className={cn((f.wide || f.type === "textarea" || f.type === "multiselect") && "sm:col-span-2")}>
                <Control f={f} id={`${uid}-${f.name}`} value={values[f.name]} invalid={!!errors[f.name]} />
              </ModalField>
            ))}
          </div>
        </ModalSection>
      ))}
    </div>
  );
}

export interface FormModalProps {
  title: string;
  description?: string;
  icon?: string;
  fields: Field[];
  values?: Record<string, unknown>;
  /** A server action taking FormData. */
  action: (fd: FormData) => Promise<FormResult>;
  submitLabel?: string;
  /** Left side of the footer: a fact about what saving does. */
  summary?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Hidden values sent with the form (ids). */
  hidden?: Record<string, string>;
  /** The button that opens the modal (plain data, so server pages can set it). Defaults to a filled "+ title" button. */
  trigger?: { label: string; variant?: "default" | "secondary" | "ghost"; size?: "default" | "sm"; plus?: boolean };
  successMessage?: string;
  /** Where to go after saving; defaults to refreshing the current page. */
  redirectTo?: string;
}

/** A complete create/edit dialog from a field list and a server action: validation errors, pending state, toast, refresh. */
export function FormModal({ title, description, icon = "users", fields, values, action, submitLabel = "Save", summary, size, hidden, trigger, successMessage = "Saved", redirectTo }: FormModalProps) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();

  const submit = (fd: FormData) => start(async () => {
    for (const f of fields) if (f.type === "money" && fd.get(f.name)) fd.set(f.name, String(Math.round(Number(fd.get(f.name)) * 100)));
    for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) {
      setErrors({});
      setOpen(false);
      toast(r.message ?? successMessage);
      if (redirectTo) router.push(redirectTo); else router.refresh();
    } else {
      setErrors(r.fieldErrors ?? {});
      toast(r.error, "danger");
    }
  });

  const openModal = () => { setErrors({}); setOpen(true); };

  return (
    <>
      <Button onClick={openModal} variant={trigger?.variant ?? "default"} size={trigger?.size ?? "default"} className="rounded-full">
        {(trigger?.plus ?? !trigger) ? <IconPlus className="mr-1.5 h-4 w-4" aria-hidden /> : null}{trigger?.label ?? title}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size={size ?? (fields.length > 6 ? "lg" : "md")} title={title} description={description}
        icon={<IconChip className="h-10 w-10"><MenuIconView name={icon} /></IconChip>} dismissOnOutsideClick={false}
        footer={<ModalFooter summary={summary} secondary={{ onClick: () => setOpen(false) }} primary={{ label: submitLabel, type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} className="pt-2" noValidate>
          <FieldGrid fields={fields} values={values} errors={errors} />
        </form>
      </Modal>
    </>
  );
}
