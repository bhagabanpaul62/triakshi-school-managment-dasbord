import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { INPUT } from "@smw/ui/tone";
import { Button } from "@smw/ui/ui/button";
import { shortDate } from "@smw/ui/format";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import type { CatalogueRow, HoldRow } from "../service";
import { cancelHold, placeHold } from "./actions";

/** Student view: search the catalogue, see how many copies are in, reserve a book that is out. */
export function Opac({ rows, holds, q, category, categories }: { rows: CatalogueRow[]; holds: HoldRow[]; q: string; category: string; categories: string[] }) {
  return (
    <>
      {holds.length ? (
        <Panel title="Your reservations">
          <ul className="flex flex-col">
            {holds.map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={h.title}>{h.title}</span>
                  <span className="block text-xs text-[var(--ds-on-surface-muted)]">{h.status === "ready" ? `Ready at the library desk until ${h.readyUntil ? shortDate(h.readyUntil) : "soon"}` : "Waiting for a copy to come back"}</span>
                </span>
                <ToneBadge label={h.status === "ready" ? "Ready" : "Waiting"} tone={h.status === "ready" ? "success" : "info"} />
                <ActionButton label="Cancel" variant="ghost" action={cancelHold} values={{ id: h.id }} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel title="Find a book">
        <form method="get" action="/app/library" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor="opac-q" className="text-sm text-[var(--ds-on-surface-variant)]">Title, author or category</label>
            <input id="opac-q" name="q" defaultValue={q} placeholder="Search the library" className={INPUT} />
          </div>
          <div className="flex min-w-36 flex-col gap-1">
            <label htmlFor="opac-cat" className="text-sm text-[var(--ds-on-surface-variant)]">Category</label>
            <select id="opac-cat" name="category" defaultValue={category} className={INPUT}>
              <option value="">All</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Button type="submit" className="rounded-full">Search</Button>
        </form>
        {rows.length === 0 ? <WidgetEmptyState title="No books found." description="Try another word, or pick All categories." /> : (
          <ul className="flex flex-col">
            {rows.map((b) => (
              <li key={b.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={b.title}>{b.title}</span>
                  <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{[b.author, b.category, b.language].join(" · ")}</span>
                </span>
                <ToneBadge label={b.copies === 0 ? "No copies" : `${b.available} of ${b.copies} in`} tone={b.available > 0 ? "success" : "warning"} />
                {b.available === 0 && b.copies > 0 ? (b.held ? <ToneBadge label="Reserved" tone="info" /> : <ActionButton label="Reserve" variant="secondary" action={placeHold} values={{ bookId: b.id }} />) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
