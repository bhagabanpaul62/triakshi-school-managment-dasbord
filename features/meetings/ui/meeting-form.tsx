"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { saveMeeting } from "./actions";
import { toIstInput } from "@smw/feature-kit/words";

export interface MeetingValues { id: string; title: string; note: string | null; audience: Audience; slotMinutes: number; perFamily: number; opensAt: Date; closesAt: Date; locked: boolean }

const FIELDS: Field[] = [
  { name: "title", label: "Name of the meeting", required: true, wide: true, placeholder: "Term 1 parent-teacher meeting" },
  { name: "note", label: "A line for families", type: "textarea", wide: true, hint: "Shown at the top of the booking page." },
  { name: "slotMinutes", label: "Minutes per family", type: "select", required: true, options: [5, 10, 15, 20, 30].map((n) => ({ value: String(n), label: `${n} minutes` })) },
  { name: "perFamily", label: "Teachers one child may book", type: "number", required: true, min: 1, max: 20 },
  { name: "opensAt", label: "Booking opens", type: "datetime-local", required: true },
  { name: "closesAt", label: "Booking closes", type: "datetime-local", required: true, hint: "India time. After this only the school office can book." },
];

/** Create a meeting or change its details. Who it is for and the slot length are fixed once booking has opened. */
export function MeetingForm({ options, meeting }: { options: AudienceOptions; meeting?: MeetingValues }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const now = Date.now();
  const values = meeting
    ? { ...meeting, opensAt: toIstInput(meeting.opensAt), closesAt: toIstInput(meeting.closesAt), slotMinutes: String(meeting.slotMinutes) }
    : { slotMinutes: "10", perFamily: 3, opensAt: toIstInput(new Date(now + 3_600_000)), closesAt: toIstInput(new Date(now + 7 * 86_400_000)) };
  const fields = meeting?.locked ? FIELDS.filter((f) => f.name !== "slotMinutes") : FIELDS;

  const submit = (fd: FormData) => start(async () => {
    if (meeting) fd.set("id", meeting.id);
    if (meeting?.locked) fd.set("slotMinutes", String(meeting.slotMinutes));
    const r = await saveMeeting(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    setErrors({}); setOpen(false); toast(r.message ?? "Saved");
    const made = r.data as { id?: string } | undefined;
    if (!meeting && made?.id) router.push(`/app/meetings/${made.id}`); else router.refresh();
  });

  return (
    <>
      <Button onClick={() => { setErrors({}); setOpen(true); }} variant={meeting ? "secondary" : "default"} className="rounded-full">
        {meeting ? null : <IconPlus className="mr-1.5 h-4 w-4" aria-hidden />}{meeting ? "Edit details" : "New meeting"}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title={meeting ? "Edit meeting" : "New meeting"} dismissOnOutsideClick={false}
        description={meeting ? undefined : "You add the teachers and their times next."}
        icon={<IconChip className="h-10 w-10"><MenuIconView name="clock" /></IconChip>}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: meeting ? "Save" : "Save and add teachers", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} className="flex flex-col gap-6 pt-2" noValidate>
          <ModalField label="Who is it for" htmlFor={`${formId}-aud`} required error={errors.audience ?? errors["include"]} hint={meeting?.locked ? "Fixed once booking has opened." : "Families of these children can book."}>
            {meeting?.locked
              ? <><input type="hidden" name="audience" value={JSON.stringify(meeting.audience)} /><p className="text-sm text-[var(--ds-on-surface-variant)]">Chosen when the meeting was created.</p></>
              : <AudiencePicker name="audience" value={meeting?.audience ?? { include: [], exclude: [] }} options={{ ...options, canFeeOverdue: false }} allow={["class", "section", "subject", "student", "group", "house"]} />}
          </ModalField>
          <FieldGrid fields={fields} values={values} errors={errors} />
        </form>
      </Modal>
    </>
  );
}
