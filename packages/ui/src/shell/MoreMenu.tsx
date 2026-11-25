"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "../lib/utils";
import { FOCUS, PILL_BTN, PRIMARY_BTN } from "../components/finance/ui";

const ITEM = `flex min-h-11 w-full items-center justify-start gap-2 rounded-xl px-3 text-left text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.08] ${FOCUS}`;
const DANGER = "text-[var(--ds-color-danger-400)]";
const FOCUSABLE = "a[href],button:not([disabled])";

/** A link inside the menu. */
export function MenuLink({ href, children, tone }: { href: string; children: ReactNode; tone?: "danger" }) {
  const cls = cn(ITEM, tone === "danger" && DANGER);
  return href.startsWith("/api/") ? <a role="menuitem" href={href} className={cls}>{children}</a> : <Link role="menuitem" href={href} className={cls}>{children}</Link>;
}

/** An action inside the menu. */
export function MenuItem({ tone, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "danger" }) {
  return <button type="button" role="menuitem" {...rest} className={cn(ITEM, tone === "danger" && DANGER, className)} />;
}

/**
 * The one dropdown: the rare steps live behind a button so a page has one main step. Arrow keys, Home and End move between items, Escape closes and
 * puts focus back on the button, a click outside or leaving with Tab closes it. The items stay mounted while shut, so a dialog an item opened
 * is not lost when the menu closes. Plain buttons placed inside (a FormModal trigger) fill the row.
 */
export function MoreMenu({ children, label = "More", icon, primary = false, align = "right" }: { children: ReactNode; label?: string; icon?: ReactNode; primary?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const shut = () => { setOpen(false); trigger.current?.focus(); };
  const show = (last = false) => { setOpen(true); requestAnimationFrame(() => { const all = items(); (last ? all.at(-1) : all[0])?.focus(); }); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) { e.stopPropagation(); shut(); return; }
    const all = items(); const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) show(); else all[(at + 1) % all.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (!open) show(true); else all[(at <= 0 ? all.length : at) - 1]?.focus(); }
    else if (open && e.key === "Home") { e.preventDefault(); all[0]?.focus(); }
    else if (open && e.key === "End") { e.preventDefault(); all.at(-1)?.focus(); }
  };
  return (
    <div ref={box} className="relative" onKeyDown={keys} onBlur={(e) => { if (open && !box.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false); }}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={primary ? PRIMARY_BTN : PILL_BTN}>
        {icon}{label}<IconChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} ref={panel} role="menu" onClick={() => setOpen(false)}
        className={cn("absolute z-30 mt-2 max-h-96 w-64 max-w-[calc(100vw-2rem)] flex-col gap-0.5 overflow-y-auto rounded-2xl bg-[var(--ds-surface-container-highest)] p-1.5 shadow-lg [&_button]:w-full [&_button]:justify-start", align === "right" ? "right-0" : "left-0", open ? "flex" : "hidden")}>
        {children}
      </div>
    </div>
  );
}
