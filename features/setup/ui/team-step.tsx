"use client";

import { FieldGrid, type Field } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { addTeam } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

const FIELDS: Field[] = [
  { name: "name", label: "Full name", required: true },
  { name: "email", label: "Email", type: "email", required: true, hint: "They get a link to set their own password." },
  { name: "role", label: "Role", type: "select", required: true, options: [{ value: "admin", label: "Admin (can do everything)" }, { value: "accountant", label: "Office (fees and money)" }] },
];

/** A second admin or an office login. Saved through the staff service, which sends the invite. */
export function TeamStep({ team, next, back, skip }: { team: { id: string; name: string; email: string | null; role: string; state: "active" | "invited" }[]; next: string; back: string | null; skip: string }) {
  const { pending, errors, run } = useStepRun(next);
  return (
    <div>
      <ul className="mb-6 flex flex-col gap-2">
        {team.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
            <span className="min-w-0"><span className="block truncate text-[var(--ds-on-surface)]">{t.name}</span><span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{t.email ?? "No email"}</span></span>
            <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{t.role === "admin" ? "Admin" : "Office"}{t.state === "invited" ? ", invited" : ""}</span>
          </li>
        ))}
      </ul>
      <form action={(fd) => run(() => addTeam(fd), (d) => { const r = d as { emailed: boolean; name: string }; toast(r.emailed ? `Invite sent to ${r.name}` : `${r.name} added`); })} noValidate>
        <FieldGrid fields={FIELDS} errors={errors} columns={1} />
        <StepFooter back={back} skip={skip} label="Add this person" pending={pending} />
      </form>
    </div>
  );
}
