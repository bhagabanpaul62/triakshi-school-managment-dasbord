"use client";

import { useState, useTransition } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { assignTask, restoreTask, skipTask, unassignTask } from "./task-actions";

export interface PersonOption { id: string; name: string; /** False when their role cannot open the task's page. */ can: boolean }

const LINK = "inline-flex min-h-10 items-center rounded-full px-3 text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.06] hover:text-[var(--ds-on-surface)]";

/** What an admin can do with one task: give it to a colleague, take it back, leave it out with a reason, bring it back. */
export function TaskControls({ taskKey, state, assigneeId, people }: { taskKey: string; state: "todo" | "skipped"; assigneeId: string | null; people: PersonOption[] }) {
  const [mode, setMode] = useState<"give" | "skip" | null>(null);
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picked = people.find((p) => p.id === who);

  const run = (act: () => ReturnType<typeof assignTask>, after?: () => void) => start(async () => {
    const r = await act();
    if (!r.ok) { setError(r.fieldErrors?.userId ?? r.fieldErrors?.reason ?? r.error); return; }
    toast(r.message ?? "Saved");
    setError(null); setMode(null); after?.();
  });

  if (state === "skipped") return <button type="button" disabled={pending} className={LINK} onClick={() => run(() => restoreTask({ key: taskKey }) as ReturnType<typeof assignTask>)}>Bring back</button>;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-1">
        {assigneeId ? <button type="button" disabled={pending} className={LINK} onClick={() => run(() => unassignTask({ key: taskKey }) as ReturnType<typeof assignTask>)}>Take back</button> : null}
        <button type="button" aria-expanded={mode === "give"} className={LINK} onClick={() => { setMode(mode === "give" ? null : "give"); setError(null); }}>{assigneeId ? "Give to someone else" : "Give to"}</button>
        <button type="button" aria-expanded={mode === "skip"} className={LINK} onClick={() => { setMode(mode === "skip" ? null : "skip"); setError(null); }}>Skip</button>
      </div>
      {mode === "give" ? (
        <div className="w-full min-w-0 sm:w-72">
          <label htmlFor={`give-${taskKey}`} className="sr-only">Give this task to</label>
          <select id={`give-${taskKey}`} value={who} onChange={(e) => { setWho(e.target.value); setError(null); }} className={INPUT}>
            <option value="">Choose a colleague</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {picked && !picked.can ? <p className="mt-1 text-xs text-[var(--ds-color-warning-400)]">{picked.name}'s role cannot open this page yet. They will see the task but not be able to do it.</p> : null}
          {error ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-300)]">{error}</p> : null}
          <Button type="button" className="mt-2 rounded-full" disabled={pending || !who} isLoading={pending} onClick={() => run(() => assignTask({ key: taskKey, userId: who }), () => setWho(""))}>Give</Button>
        </div>
      ) : null}
      {mode === "skip" ? (
        <div className="w-full min-w-0 sm:w-72">
          <label htmlFor={`skip-${taskKey}`} className="sr-only">Why leave this out</label>
          <input id={`skip-${taskKey}`} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} placeholder="Why? For example: we do not run buses" className={INPUT} maxLength={300} />
          {error ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-300)]">{error}</p> : null}
          <Button type="button" variant="secondary" className="mt-2 rounded-full" disabled={pending || reason.trim().length < 3} isLoading={pending} onClick={() => run(() => skipTask({ key: taskKey, reason }) as ReturnType<typeof assignTask>, () => setReason(""))}>Leave it out</Button>
        </div>
      ) : null}
    </div>
  );
}
