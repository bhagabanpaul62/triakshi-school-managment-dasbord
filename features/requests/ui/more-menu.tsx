"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@smw/ui/ui/button";

/**
 * The less common steps behind one button. The panel stays mounted when closed (hidden), so a form opened from it keeps its state.
 * It closes on a click inside, a click outside and Escape.
 */
export function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <Button type="button" variant="secondary" className="rounded-full" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>More</Button>
      <div id={panel} hidden={!open} onClick={() => setOpen(false)}
        className="absolute left-0 top-full z-20 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-1 rounded-2xl bg-[var(--ds-surface-container-high)] p-2 shadow-lg [&_button]:w-full [&_button]:justify-start">
        {children}
      </div>
    </div>
  );
}
