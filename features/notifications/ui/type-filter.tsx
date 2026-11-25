"use client";

import { useRouter } from "next/navigation";

/** One menu for the type of notification, in place of a wall of chips. The page stays in the URL, so the back button and links work. */
export function TypeFilter({ value, options, base }: { value: string; options: { value: string; label: string }[]; /** Query string of everything else (tab, unread), without the type. */ base: string }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]">
      <span className="sr-only sm:not-sr-only">Type</span>
      <select value={value} aria-label="Type of notification"
        onChange={(e) => { const p = new URLSearchParams(base); if (e.target.value) p.set("group", e.target.value); router.push(`?${p}`); }}
        className="h-10 rounded-full bg-white/[0.06] px-4 text-sm text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
        <option value="">All types</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
