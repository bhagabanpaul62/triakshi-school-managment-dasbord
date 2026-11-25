"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Modal, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { MAX_LEVELS, MAX_QUESTIONS, NATURE_WORDS, type EscalationLevel, type Nature, type RequestField } from "../constants";

export interface CategoryFormValues { id?: string; name: string; nature: Nature; ownerRole: string; targetDays: number; escalation: EscalationLevel[]; fields: RequestField[] }
type Role = { value: string; label: string };
/** A row keeps its own number while rows come and go, so what is typed never slides into another row. */
type Row<T> = { n: number; value?: T };

const SECTION = "Extra questions for the family";
const levelFields = (n: number, roles: Role[]): Field[] => [
  { name: `l${n}_label`, label: "Name this level", placeholder: "Principal", wide: true },
  { name: `l${n}_role`, label: "Goes to", type: "select", options: roles },
  { name: `l${n}_days`, label: "Days they have", type: "number", min: 1, max: 60 },
];
const questionFields = (n: number): Field[] => [
  { name: `f${n}_label`, label: "Question", placeholder: "For example: Which dates", wide: true },
  { name: `f${n}_kind`, label: "Kind of answer", type: "select", options: [{ value: "text", label: "Words" }, { value: "date", label: "A date" }, { value: "choice", label: "One of a list" }] },
  { name: `f${n}_options`, label: "The list (comma between)", placeholder: "Bonafide, Transfer" },
  { name: `f${n}_required`, label: "Must be answered", type: "checkbox", placeholder: "Required" },
];

function Rows<T>({ title, noun, rows, max, setRows, make, render }: {
  title: string; noun: string; rows: Row<T>[]; max: number; setRows: (r: Row<T>[]) => void; make: () => number; render: (r: Row<T>) => React.ReactNode;
}) {
  return (
    <ModalSection title={title}>
      <div className="flex flex-col gap-4">
        {rows.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">None yet.</p> : null}
        {rows.map((r, i) => (
          <div key={r.n} className="rounded-2xl bg-white/[0.04] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--ds-on-surface-variant)]">{noun} {i + 1}</span>
              <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setRows(rows.filter((x) => x.n !== r.n))} aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`}>
                <IconTrash className="mr-1 h-4 w-4" aria-hidden />Remove
              </Button>
            </div>
            {render(r)}
          </div>
        ))}
        {rows.length < max
          ? <Button type="button" variant="secondary" size="sm" className="self-start rounded-full" onClick={() => setRows([...rows, { n: make() }])}><IconPlus className="mr-1 h-4 w-4" aria-hidden />Add {noun.toLowerCase()}</Button>
          : <p className="text-xs text-[var(--ds-on-surface-muted)]">That is the most ({max}).</p>}
      </div>
    </ModalSection>
  );
}

/** Add or edit a category. Any number of late levels (up to 5) and extra questions (up to 8), each added and removed on its own. */
export function CategoryForm({ title, roles, initial, action, trigger }: {
  title: string; roles: Role[]; initial?: CategoryFormValues; action: (fd: FormData) => Promise<FormResult>; trigger: { label: string; edit?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const next = useRef(0);
  const fresh = () => ++next.current;
  const seed = <T,>(list: T[] = []): Row<T>[] => list.map((value) => ({ n: fresh(), value }));
  const [levels, setLevels] = useState<Row<EscalationLevel>[]>(() => seed(initial?.escalation));
  const [questions, setQuestions] = useState<Row<RequestField>[]>(() => seed(initial?.fields));

  const reopen = () => { setErrors({}); setLevels(seed(initial?.escalation)); setQuestions(seed(initial?.fields)); setOpen(true); };
  const submit = (fd: FormData) => start(async () => {
    if (initial?.id) fd.set("id", initial.id);
    const r = await action(fd);
    if (r.ok) { setOpen(false); toast(r.message ?? "Saved"); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });

  const top: Field[] = [
    { name: "name", label: "Name", required: true, wide: true },
    { name: "nature", label: "Kind", type: "select", required: true, options: Object.entries(NATURE_WORDS).map(([value, label]) => ({ value, label })), hint: "A complaint about a person is hidden from that person. A safety concern goes only to safeguarding." },
    { name: "ownerRole", label: "Answered by", type: "select", required: true, options: roles },
    { name: "targetDays", label: "Days to answer", type: "number", required: true, min: 1, max: 60 },
  ];
  return (
    <>
      <Button onClick={reopen} variant={trigger.edit ? "secondary" : "default"} className="rounded-full">
        {trigger.edit ? null : <IconPlus className="mr-1.5 h-4 w-4" aria-hidden />}{trigger.label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title={title} icon={<IconChip className="h-10 w-10"><MenuIconView name="inbox" /></IconChip>} dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: trigger.edit ? "Save" : "Add", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} className="flex flex-col gap-6 pt-2" noValidate>
          <FieldGrid fields={top} values={initial ? { ...initial } : { nature: "general", ownerRole: "admin", targetDays: 3 }} errors={errors} />
          <Rows title="If it is late, it goes up" noun="Level" rows={levels} max={MAX_LEVELS} setRows={setLevels} make={fresh}
            render={(r) => <FieldGrid fields={levelFields(r.n, roles)} values={{ [`l${r.n}_label`]: r.value?.label, [`l${r.n}_role`]: r.value?.role ?? roles[0]?.value, [`l${r.n}_days`]: r.value?.afterDays ?? 2 }} errors={errors} />} />
          <Rows title={SECTION} noun="Question" rows={questions} max={MAX_QUESTIONS} setRows={setQuestions} make={fresh}
            render={(r) => (
              <>
                {/* A new question gets an id of its own, so it never inherits answers of one that was removed. */}
                <input type="hidden" name={`f${r.n}_id`} defaultValue={r.value?.id ?? `q${Date.now().toString(36)}${r.n}`} />
                <FieldGrid fields={questionFields(r.n)} errors={errors}
                  values={{ [`f${r.n}_label`]: r.value?.label, [`f${r.n}_kind`]: r.value?.kind ?? "text", [`f${r.n}_options`]: r.value?.options?.join(", "), [`f${r.n}_required`]: r.value?.required }} />
              </>
            )} />
        </form>
      </Modal>
    </>
  );
}
