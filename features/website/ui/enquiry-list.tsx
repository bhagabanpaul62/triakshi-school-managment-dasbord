"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { DataTable, type DataTableProps } from "@smw/ui/shell/DataTable";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { BulkBar } from "@smw/ui/finance/BulkBar";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";

type Mode = "assign" | "stage" | "close";
interface Props extends Omit<DataTableProps, "leading"> {
  people: { id: string; name: string }[];
  reasons: string[];
  stages: { value: string; label: string }[];
  /** May give enquiries to people (the pipeline right). */
  canAssign: boolean;
  action: (fd: FormData) => Promise<FormResult>;
}

const box = "h-5 w-5 cursor-pointer accent-[var(--ds-primary)]";

/** The enquiry list with a checkbox on every row and a bar to give, move or close many at once. Each row is its own: those that cannot change are named. */
export function EnquiryList({ people, reasons, stages, canAssign, action, rows, ...table }: Props) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode | null>(null);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const ids = rows.map((r) => String(r.id)).filter((id) => chosen.has(id));
  const allOn = rows.length > 0 && ids.length === rows.length;
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = () => start(async () => {
    const fd = new FormData();
    for (const id of ids) fd.append("ids", id);
    fd.set("action", mode!);
    if (mode === "assign" && value) fd.set("ownerId", value);
    if (mode === "stage") fd.set("to", value);
    if (mode === "close") fd.set("reason", value);
    const r = await action(fd);
    if (!r.ok) { toast(r.error, "danger"); return; }
    const d = r.data as { done: number; skipped: { ref: string | null; why: string }[] };
    toast(d.skipped.length ? `${d.done} changed. ${d.skipped.length} not changed: ${d.skipped[0]!.ref ?? "one"} ${d.skipped[0]!.why}` : `${d.done} changed`, d.skipped.length ? "danger" : "default");
    setMode(null); setValue(""); setChosen(new Set()); router.refresh();
  });

  const cells = Object.fromEntries(rows.map((r) => [String(r.id), (
    <label key={String(r.id)} className="flex h-10 w-10 items-center justify-center"><span className="sr-only">Select {String(r.studentName)}</span>
      <input type="checkbox" checked={chosen.has(String(r.id))} onChange={() => toggle(String(r.id))} className={cn(box)} /></label>
  )]));
  const options = mode === "assign" ? [{ value: "", label: "Nobody (take the owner off)" }, ...people.map((p) => ({ value: p.id, label: p.name }))] : mode === "stage" ? stages.filter((s) => s.value !== "admitted" && s.value !== "closed") : reasons.map((r) => ({ value: r, label: r }));
  const title = mode === "assign" ? "Give to a person" : mode === "stage" ? "Move to a stage" : "Close these enquiries";

  return (
    <>
      <DataTable {...table} rows={rows} leading={{ cells, header: (
        <label className="flex h-10 w-10 items-center justify-center"><span className="sr-only">Select all on this page</span>
          <input type="checkbox" checked={allOn} onChange={() => setChosen(allOn ? new Set() : new Set(rows.map((r) => String(r.id))))} className={box} /></label>
      ) }} />
      <BulkBar count={ids.length} noun="enquiry" onClear={() => setChosen(new Set())}
        actions={[...(canAssign ? [{ label: "Give to…", onClick: () => { setMode("assign"); setValue(""); } }] : []), { label: "Move to…", onClick: () => { setMode("stage"); setValue("contacted"); } }, { label: "Close…", tone: "danger" as const, onClick: () => { setMode("close"); setValue(reasons[0] ?? ""); } }]} />
      <Modal open={mode !== null} onOpenChange={(o) => !o && setMode(null)} size="sm" title={title} description={`${ids.length} selected`}
        footer={<ModalFooter secondary={{ onClick: () => setMode(null) }} primary={{ label: mode === "close" ? "Close them" : "Do it", onClick: run, loading: pending }} />}>
        <label className="flex flex-col gap-1.5 pt-2 text-sm"><span className="text-[var(--ds-on-surface-variant)]">{mode === "close" ? "Why" : mode === "stage" ? "Stage" : "Who"}</span>
          <select value={value} onChange={(e) => setValue(e.target.value)} className={INPUT}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      </Modal>
    </>
  );
}
