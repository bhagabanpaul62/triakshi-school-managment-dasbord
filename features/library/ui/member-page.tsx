import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { paise, shortDate } from "@smw/ui/format";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import { LibrarySettingsService, LoanService } from "../service";
import { renewLoan, returnLoan } from "./actions";
import { returnConfirm } from "./return-confirm";

export const metadata = { title: "Member history" };

const TONE = { open: "info", overdue: "danger", returned: "default" } as const;
const LABEL = { open: "Out", overdue: "Overdue", returned: "Returned" } as const;

/** Everything one student or staff member has borrowed. */
export default async function MemberPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const ctx = await requireCtx();
  const svc = new LoanService(ctx);
  const [who, rules] = await Promise.all([svc.memberInfo(kind, id), new LibrarySettingsService(ctx).get()]);
  const rows = await svc.memberHistory(who.kind === "student" ? { studentId: id } : { userId: id });
  const canManage = svc.can("manage");
  const out = rows.filter((r) => !r.returnedOn).length;
  const fines = rows.reduce((a, r) => a + r.finePaise, 0);

  return (
    <>
      <PageHeader eyebrow="Library" title={who.name} description={`${who.meta}. ${rows.length} ${rows.length === 1 ? "book" : "books"} borrowed, ${out} out now${fines ? `, fines ${paise(fines)}` : ""}.`}
        actions={<Link href="/app/library/loans" className="text-sm text-[var(--ds-on-surface-variant)] underline-offset-2 hover:underline">All loans</Link>} />
      <Panel title="Borrowing history">
        {rows.length === 0 ? <WidgetEmptyState title="Nothing borrowed yet." description="Books issued to this member will be listed here." /> : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={r.title}>{r.title}</span>
                  <span className="block text-xs text-[var(--ds-on-surface-muted)]">
                    {r.accessionLabel} · issued {shortDate(r.issuedOn)} · {r.returnedOn ? `back ${shortDate(r.returnedOn)}` : `due ${shortDate(r.dueOn)}`}
                    {r.renewals ? ` · renewed ${r.renewals}x` : ""}{r.finePaise > 0 ? ` · fine ${paise(r.finePaise)}` : r.fineWaived ? " · fine waived" : ""}
                  </span>
                </span>
                <ToneBadge label={LABEL[r.status]} tone={TONE[r.status]} />
                {canManage && !r.returnedOn ? (
                  <span className="inline-flex items-center gap-1">
                    {r.renewals < rules.renewalsAllowed ? <ActionButton label="Renew" variant="ghost" action={renewLoan} values={{ id: r.id }} /> : null}
                    <ActionButton label="Return" variant="secondary" action={returnLoan} values={{ id: r.id }} confirm={returnConfirm(r)} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
