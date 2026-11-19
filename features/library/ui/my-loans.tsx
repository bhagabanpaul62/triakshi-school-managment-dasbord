import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState, ROW_HOVER } from "@smw/ui/widgets/WidgetPrimitives";
import { paise, shortDate } from "@smw/ui/format";
import type { LoanRow } from "../service";

const TONE = { open: "info", overdue: "danger", returned: "default" } as const;
const LABEL = { open: "With you", overdue: "Overdue", returned: "Returned" } as const;

/** Student and parent view: their library books and any fine. */
export function MyLoans({ rows, showName }: { rows: LoanRow[]; showName: boolean }) {
  const fine = rows.reduce((a, r) => a + r.finePaise, 0);
  if (!rows.length) return <WidgetEmptyState title="No library books yet." description="Books borrowed from the school library will show up here." />;
  return (
    <Panel title="Library books" action={fine > 0 ? <ToneBadge label={`Fines ${paise(fine)}`} tone="warning" /> : null}>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm" title={r.title}>{r.title}</span>
              <span className="block text-xs text-[var(--ds-on-surface-muted)]">
                {showName ? `${r.borrowerName} · ` : ""}Issued {shortDate(r.issuedOn)} · {r.returnedOn ? `back ${shortDate(r.returnedOn)}` : `due ${shortDate(r.dueOn)}`}
                {r.finePaise > 0 ? ` · fine ${paise(r.finePaise)}` : ""}
              </span>
            </span>
            <ToneBadge label={LABEL[r.status]} tone={TONE[r.status]} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
