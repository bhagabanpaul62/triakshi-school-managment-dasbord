import Link from "next/link";
import { allows } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import financeFeature from "../feature";

/** The ledger entry behind a document. People who cannot open the ledger see plain words, never a link to a refusal. */
export async function JournalLink({ id, label = "Ledger entry", none = "Not posted yet" }: { id: string | null | undefined; label?: string; none?: string | null }) {
  const ctx = await requireCtx();
  if (!allows(ctx, financeFeature, "read")) return null;
  if (!id) return none ? <span className="text-sm text-[var(--ds-on-surface-muted)]">{none}</span> : null;
  return <Link href={`/app/finance/journals/${id}`} className="text-sm underline underline-offset-4">{label}</Link>;
}
