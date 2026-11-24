"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { copyPlan, newPlanVersion } from "./actions";

/** Starts a new draft version of a published plan and opens it to edit. */
export function NewVersionButton({ rootId }: { rootId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" className="rounded-full" isLoading={pending} onClick={() => start(async () => {
      const fd = new FormData(); fd.set("rootId", rootId);
      const r = await newPlanVersion(fd);
      if (!r.ok) return void toast(r.error, "danger");
      toast("New draft version made"); router.push(`/app/fees/plans/${r.data.id}/edit`);
    })}>New version</Button>
  );
}

/** Copies a plan to another year (dates move by whole years), as a draft. */
export function CopyPlanButton({ id, name, years }: { id: string; name: string; years: { id: string; name: string }[] }) {
  const router = useRouter(), uid = useId();
  const [open, setOpen] = useState(false), [yearId, setYearId] = useState(years[0]?.id ?? ""), [title, setTitle] = useState(`${name} (copy)`), [error, setError] = useState("");
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const fd = new FormData(); fd.set("id", id); fd.set("yearId", yearId); fd.set("name", title);
    const r = await copyPlan(fd);
    if (!r.ok) return void setError(r.error);
    toast("Copied as a draft"); setOpen(false); router.push(`/app/fees/plans/${r.data.id}/edit`);
  });
  return (
    <>
      <Button type="button" variant="secondary" className="rounded-full" onClick={() => { setError(""); setOpen(true); }}>Copy to a year</Button>
      <Modal open={open} onOpenChange={setOpen} size="sm" title="Copy this plan" description="A new draft in the year you pick, with the dates moved by whole years. Edit the amounts, then send it for approval." dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Copy", onClick: run, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2">
          <ModalField label="Into year" htmlFor={`${uid}-y`}><select id={`${uid}-y`} value={yearId} onChange={(e) => setYearId(e.target.value)} className={INPUT}>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></ModalField>
          <ModalField label="Name" htmlFor={`${uid}-n`} error={error || undefined}><input id={`${uid}-n`} value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} /></ModalField>
        </div>
      </Modal>
    </>
  );
}
