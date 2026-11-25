import Link from "next/link";
import { cn } from "../../lib/utils";
import { FOCUS } from "../finance/ui";

export interface SavedView {
  key: string;
  label: string;
  /** How many records are in this view. Shown as a number, never hidden when zero. */
  count?: number;
}

export interface SavedViewsProps {
  views: SavedView[];
  /** The selected key; the first view is the default and keeps the URL clean. */
  active: string;
  /** Path of this page, for example "/notices". */
  basePath: string;
  /** The current search params, so search and filters survive a change of view. */
  params?: Record<string, string | undefined>;
  /** Query name, "view" by default. */
  param?: string;
  label?: string;
}

/** Queue tabs driven by the URL: "Needs me 4 | Waiting 2 | Done 31". Same look as the kit TabBar (a soft filled pill, never white). Scrolls sideways inside itself on a phone. */
export function SavedViews({ views, active, basePath, params = {}, param = "view", label = "Views" }: SavedViewsProps) {
  const href = (key: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== param && k !== "page") q.set(k, v);
    if (key !== views[0]?.key) q.set(param, key);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex w-max items-center gap-1 rounded-full bg-white/[0.05] p-1">
        {views.map((v) => (
          <li key={v.key}>
            <Link href={href(v.key)} aria-current={v.key === active ? "page" : undefined}
              className={cn("flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors", FOCUS, v.key === active ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>
              {v.label}
              {v.count !== undefined ? <span className="rounded-full bg-white/[0.1] px-1.5 py-px text-[11px] tabular-nums text-[var(--ds-on-surface-variant)]">{v.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
