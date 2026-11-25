"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { PRIMARY_BTN } from "@smw/ui/finance/ui";
import { cn } from "@smw/ui/utils";

const ITEM = "flex min-h-10 items-center rounded-xl px-3 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";

/** "New notice": a notice, a circular, an urgent alert (only for those who may send one), or a start from a template. */
export function NewMenu({ urgent, templates }: { urgent: boolean; templates: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={PRIMARY_BTN}><IconPlus className="h-4 w-4" aria-hidden />New notice<IconChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden /></button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 flex max-h-96 w-64 max-w-[calc(100vw-2rem)] flex-col gap-0.5 overflow-y-auto rounded-2xl bg-[var(--ds-surface-container-highest)] p-1.5 shadow-lg">
          <Link role="menuitem" href="/app/announcements/new" className={ITEM} onClick={() => setOpen(false)}>Notice</Link>
          <Link role="menuitem" href="/app/announcements/new?type=circular" className={ITEM} onClick={() => setOpen(false)}>Circular with a number</Link>
          {urgent ? <Link role="menuitem" href="/app/announcements/new?type=urgent" className={cn(ITEM, "text-[var(--ds-color-danger-400)]")} onClick={() => setOpen(false)}>Urgent alert</Link> : null}
          {templates.length ? <p className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">From a template</p> : null}
          {templates.map((t) => <Link key={t.id} role="menuitem" href={`/app/announcements/new?template=${t.id}`} className={ITEM} onClick={() => setOpen(false)}><span className="truncate">{t.name}</span></Link>)}
        </div>
      ) : null}
    </div>
  );
}
