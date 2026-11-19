import type { ReactNode } from "react";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";

export interface MiniItem { id: string; title: ReactNode; meta?: ReactNode; actions?: ReactNode }

/** A short list of records with per-row actions, for panels (sections, subjects, terms). */
export function MiniList({ items, empty }: { items: MiniItem[]; empty: { title: string; description: string } }) {
  if (items.length === 0) return <WidgetEmptyState {...empty} />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl bg-white/[0.035] px-4 py-3">
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm text-[var(--ds-on-surface)]">{i.title}</p>
            {i.meta ? <p className="mt-0.5 truncate text-xs text-[var(--ds-on-surface-muted)]">{i.meta}</p> : null}
          </div>
          {i.actions ? <div className="flex flex-wrap items-center gap-1">{i.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
}
