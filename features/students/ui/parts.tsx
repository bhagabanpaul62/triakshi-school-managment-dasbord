import type { ReactNode } from "react";
import { initials } from "@smw/ui/format";
import { ROW_HOVER, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";

/** Round avatar: the photo when there is one, otherwise initials. */
export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size };
  return src ? (
    // Signed storage URLs expire in minutes, so they cannot go through the image optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs text-[var(--ds-on-surface)]" aria-hidden>{initials(name)}</span>
  );
}

export interface RowItem {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  /** Chips and short facts on the right. */
  trailing?: ReactNode;
  /** Buttons on the far right (edit, delete). */
  actions?: ReactNode;
}

/** Flat rows inside a Panel: used by every tab so lists look the same. Empty state is one line plus the action. */
export function RowList({ items, empty }: { items: RowItem[]; empty: { title: string; description: string; action?: ReactNode } }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center gap-3">
        <WidgetEmptyState title={empty.title} description={empty.description} />
        {empty.action}
      </div>
    );
  }
  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {items.map((it) => (
        <li key={it.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${ROW_HOVER}`}>
          {it.leading ? <span className="shrink-0">{it.leading}</span> : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[var(--ds-on-surface)]">{it.title}</div>
            {it.subtitle ? <div className="mt-0.5 truncate text-xs text-[var(--ds-on-surface-muted)]">{it.subtitle}</div> : null}
          </div>
          {it.trailing ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-[var(--ds-on-surface-muted)]">{it.trailing}</div> : null}
          {it.actions ? <div className="flex shrink-0 items-center gap-1">{it.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
}
