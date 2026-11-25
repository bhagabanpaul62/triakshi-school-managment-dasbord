"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { when } from "../format";
import { changeWindow, removeWindow } from "./actions";

interface Dropped { slotId: string; studentName: string; startsAt: Date | string; teacherName: string }
interface Change { applied: boolean; dropped: Dropped[] }
export interface WindowValues { id: string; teacherName: string; day: string; from: string; to: string; place: string | null; videoUrl: string | null }

const FIELDS: Field[] = [
  { name: "day", label: "Day", type: "date", required: true },
  { name: "from", label: "From", type: "time", required: true },
  { name: "to", label: "To", type: "time", required: true },
  { name: "place", label: "Room", wide: true },
  { name: "videoUrl", label: "Video link", wide: true, hint: "For families who join online." },
  { name: "breakFrom", label: "Break from", type: "time", hint: "Leave empty to keep the current break." },
  { name: "breakTo", label: "Break to", type: "time" },
];

/**
 * Change or remove one teacher's time. Nothing is saved while bookings would be dropped: the list comes first,
 * and only a second tap on "Drop N bookings and tell families" applies it.
 */
export function WindowEditor({ window: w, mode }: { window: WindowValues; mode: "change" | "remove" }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [drops, setDrops] = useState<Dropped[] | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const remove = mode === "remove";

  const run = (fd: FormData, confirm: boolean) => start(async () => {
    fd.set("windowId", w.id);
    if (confirm) fd.set("confirm", "true");
    const r = await (remove ? removeWindow : changeWindow)(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    const c = r.data as Change;
    if (!c.applied) { setDrops(c.dropped); return; }
    setOpen(false); setDrops(null); setErrors({});
    toast(remove ? "Teacher time removed" : "Teacher time changed");
    router.refresh();
  });

  const close = () => { setOpen(false); setDrops(null); setErrors({}); };
  const confirmLabel = drops ? `Drop ${drops.length} ${drops.length === 1 ? "booking" : "bookings"} and tell the families` : "";

  return (
    <>
      <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen(true)}>{remove ? "Remove" : "Change"}</Button>
      <Modal open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} size="md" dismissOnOutsideClick={false}
        title={remove ? `Remove ${w.teacherName}?` : `Change ${w.teacherName}'s time`}
        icon={<IconChip className="h-10 w-10"><MenuIconView name="clock" /></IconChip>}
        footer={<ModalFooter secondary={{ onClick: close }}
          primary={drops ? { label: confirmLabel, onClick: () => run(new FormData(document.getElementById(formId) as HTMLFormElement), true), loading: pending }
            : { label: remove ? "Remove this time" : "Save", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues((fd) => run(fd, false))} className="flex flex-col gap-4 pt-2" noValidate>
          {remove ? <p className="text-sm text-[var(--ds-on-surface-variant)]">All of this teacher's free times in this meeting go. Families who booked are listed first.</p>
            : <FieldGrid fields={FIELDS} values={{ ...w }} errors={errors} />}
          {drops ? (
            <div role="alert" className="rounded-2xl bg-white/[0.05] p-4">
              <p className="text-sm font-medium">These bookings no longer fit and would be dropped:</p>
              <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm text-[var(--ds-on-surface-variant)]">
                {drops.map((d) => <li key={d.slotId}>{d.studentName}, {when(new Date(d.startsAt))}</li>)}
              </ul>
              <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Each family is told and can book another time. Nothing has been saved yet.</p>
            </div>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
