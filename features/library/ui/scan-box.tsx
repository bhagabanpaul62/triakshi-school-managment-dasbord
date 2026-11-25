"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { IconBarcode } from "@tabler/icons-react";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { INPUT } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { returnLoan, scanCopy } from "./actions";
import { returnConfirm } from "./return-confirm";

export type ScannedBook = { bookId: string; title: string; author: string; copyId: string; accessionLabel: string; available: number };
type Scan = {
  state: "available" | "issued" | "lost" | "damaged"; book: ScannedBook;
  loan: { id: string; title: string; borrowerName: string; dueOn: string; daysLate: number; finePaise: number } | null;
};

/** Type or scan an accession number and press Enter. Out -> offer Return. On the shelf -> start Issue. */
export function ScanBox({ onIssue }: { onIssue?: (b: ScannedBook) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const look = () => start(async () => {
    if (!text.trim()) return;
    const r = await scanCopy(text);
    if (!r.ok) { setFound(null); setError(r.error); return; }
    setError(null);
    const s = r.data as Scan;
    setFound(s);
    setText("");
    if (s.state === "available" && onIssue) onIssue(s.book);
  });

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-[var(--ds-on-surface-variant)]">Scan or type an accession number</label>
      <div className="flex items-center gap-2">
        <IconBarcode className="h-5 w-5 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="ACC-00012, then Enter" autoComplete="off" inputMode="text" disabled={pending}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); look(); } }} className={INPUT} />
      </div>
      <div aria-live="polite" className="min-h-6 text-sm">
        {error ? <p role="alert" className="text-[var(--ds-color-danger-400)]">{error}</p> : null}
        {found ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{found.book.accessionLabel}</span>
            <span className="min-w-0 truncate">{found.book.title}</span>
            {found.loan ? (
              <>
                <ToneBadge label={`Out with ${found.loan.borrowerName}, due ${shortDate(found.loan.dueOn)}`} tone={found.loan.daysLate > 0 ? "danger" : "info"} />
                <ActionButton label="Return" variant="secondary" action={returnLoan} values={{ id: found.loan.id }} confirm={returnConfirm(found.loan)} />
              </>
            ) : found.state === "available" ? (
              onIssue ? <ToneBadge label="On the shelf. Pick the student to issue." tone="success" />
                : <Link href={`/app/library?scan=${found.book.accessionLabel}`} className="text-[var(--ds-primary-text)] underline-offset-2 hover:underline">On the shelf. Start issue</Link>
            ) : <ToneBadge label={found.state === "lost" ? "Marked lost" : "Marked damaged"} tone="warning" />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
