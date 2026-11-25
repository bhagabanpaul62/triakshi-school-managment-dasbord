import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { StudentService } from "@smw/feature-students/service";
import { requireCtx } from "@smw/runtime";
import { FormModal } from "@smw/ui/shell/FormModal";
import { eraseStudent } from "./actions";

/** The deletion card of a privacy request: what is blanked, what stays, and the typed confirmation. Joins settings and students here, in the app. */
export async function ErasureCard({ studentId, requestId }: { studentId: string | null; requestId: string }) {
  const ctx = await requireCtx();
  if (!studentId) return <p className="text-sm text-[var(--ds-on-surface-variant)]">Choose the student this is about when you write the request down. A request about a staff member or someone not in the records is done by hand: add a step for each thing you delete.</p>;
  if (!ctx.features.has("students")) return <p className="text-sm text-[var(--ds-on-surface-variant)]">The Students module is off for this school, so there is nothing to blank here.</p>;
  const p = await new StudentService(ctx).erasePreview(studentId).catch((e) => { if (e instanceof NotFoundError) return null; throw e; });
  if (!p) return <p className="text-sm text-[var(--ds-on-surface-variant)]">This student no longer exists in the records. Close the request and say so.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ds-on-surface)]">{p.name} <span className="text-[var(--ds-on-surface-muted)]">({p.admissionNo})</span></p>
      {p.refusal ? (
        <p className="rounded-2xl bg-[var(--ds-color-warning-500)]/10 p-3 text-sm text-[var(--ds-on-surface)]">{p.refusal} <Link href={`/app/students/${p.id}`} className="text-[var(--ds-primary-text)] underline">Open the student</Link></p>
      ) : null}
      <div>
        <p className="text-xs text-[var(--ds-on-surface-muted)]">Will be blanked</p>
        <ul className="mt-1 flex flex-col gap-1 text-sm text-[var(--ds-on-surface-variant)]">
          {p.blank.map((b) => <li key={b.label}>{b.label}{b.filled ? "" : <span className="text-[var(--ds-on-surface-muted)]"> (nothing there)</span>}</li>)}
          {p.guardians.map((g) => <li key={g.name}>{g.name}: {g.why}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-xs text-[var(--ds-on-surface-muted)]">The school must keep</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--ds-on-surface-variant)]">{p.keep.map((k) => <li key={k}>{k}</li>)}</ul>
      </div>
      {!p.refusal ? (
        <FormModal title="Erase optional data" icon="shield" description="This cannot be undone. The student's login is turned off." submitLabel="Erase it"
          fields={[{ name: "confirm", label: `Type the admission number (${p.admissionNo}) to confirm`, required: true, wide: true }, { name: "reason", label: "Why", type: "textarea", required: true, wide: true, hint: "At least 10 characters. It is saved in the audit log." }]}
          hidden={{ studentId: p.id, requestId }} action={eraseStudent} trigger={{ label: "Erase optional data", variant: "default", plus: false }} />
      ) : null}
    </div>
  );
}
