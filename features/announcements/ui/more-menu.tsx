"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { cn } from "@smw/ui/utils";

const ITEM = "flex min-h-10 w-full items-center justify-start rounded-xl px-3 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";

/** A link inside the menu. */
export const MenuLink = ({ href, children }: { href: string; children: ReactNode }) => <Link role="menuitem" href={href} className={ITEM}>{children}</Link>;

/**
 * The quiet "More" menu: the rare steps live here so a page has one main button. The items stay mounted while the menu is shut,
 * so a dialog an item opened is not lost when the menu closes. Buttons placed inside fill the row.
 */
export function MoreMenu({ children, label = "More" }: { children: ReactNode; label?: string }) {
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
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={PILL_BTN}>{label}<IconChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden /></button>
      <div role="menu" onClick={() => setOpen(false)} className={cn("absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] flex-col gap-0.5 rounded-2xl bg-[var(--ds-surface-container-highest)] p-1.5 shadow-lg [&_button]:w-full [&_button]:justify-start", open ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}
