"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/tone";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { saveGroup } from "./actions";

export interface GroupFormProps { group?: { id: string; name: string; audience: Audience; shared: boolean }; options: AudienceOptions; canShare: boolean }

/** A saved audience such as "Class 8 science students". Private to its maker, or shared with every teacher. */
export function GroupForm({ group, options, canShare }: GroupFormProps) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>(group?.audience ?? { include: [], exclude: [] });
  const [shared, setShared] = useState(group?.shared ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("shared", shared ? "1" : "0");
    if (group) fd.set("id", group.id);
    start(async () => {
      const r = await saveGroup(fd).catch(() => null);
      if (r?.ok) { toast(r.message ?? "Saved"); setOpen(false); if (!group) { setAudience({ include: [], exclude: [] }); } router.refresh(); return; }
      setErrors(r && !r.ok ? r.fieldErrors ?? {} : {});
      toast(r && !r.ok ? r.error : "No connection. Nothing was saved.", "danger");
    });
  };
  return (
    <>
      <button type="button" className={group ? PILL_BTN : PRIMARY_BTN} onClick={() => { setErrors({}); setOpen(true); }}>{group ? "Edit" : <><IconPlus className="h-4 w-4" aria-hidden />New group</>}</button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title={group ? "Edit group" : "New saved group"} description="Pick this group as the audience of a notice, a message or a meeting." dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Save", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={submit} className="flex flex-col gap-4 pt-2" noValidate>
          <ModalField label="Name" htmlFor={`${formId}-name`} error={errors.name}><input id={`${formId}-name`} name="name" defaultValue={group?.name} maxLength={80} required aria-invalid={!!errors.name || undefined} className={INPUT} /></ModalField>
          <ModalField label="Who is in it" htmlFor={`${formId}-aud`} error={errors.audience}><AudiencePicker name="audience" value={audience} onChange={setAudience} options={options} /></ModalField>
          {canShare ? <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="h-5 w-5 accent-[var(--ds-primary)]" />Share it with every teacher</label> : null}
        </form>
      </Modal>
    </>
  );
}
