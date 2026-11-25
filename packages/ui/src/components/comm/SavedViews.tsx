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

/** Queue tabs driven by the URL: "Needs me 4 | Waiting 2 | Done 31". Scrolls sideways inside itself on a phone. */
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
      <ul className="flex w-max gap-1 rounded-full bg-white/[0.04] p-1">
        {views.map((v) => (
          <li key={v.key}>
            <Link href={href(v.key)} aria-current={v.key === active ? "page" : undefined}
              className={cn("flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm transition-colors", FOCUS, v.key === active ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.08]")}>
              {v.label}
              {v.count !== undefined ? <span className="text-xs tabular-nums opacity-70">{v.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
