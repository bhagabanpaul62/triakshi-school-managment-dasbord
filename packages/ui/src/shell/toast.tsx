"use client";

import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

type Toast = { id: number; text: string; tone: "default" | "danger" };
let listeners: ((t: Toast[]) => void)[] = [];
let items: Toast[] = [];
let seq = 0;

/** Show a short message bottom-right for 4 seconds. */
export function toast(text: string, tone: Toast["tone"] = "default") {
  const t = { id: ++seq, text, tone };
  items = [...items, t];
  listeners.forEach((l) => l(items));
  setTimeout(() => { items = items.filter((x) => x.id !== t.id); listeners.forEach((l) => l(items)); }, 4000);
}

/** Mount once in the root layout. */
export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter((l) => l !== setList); }; }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} role="status" className={cn("rounded-2xl bg-[var(--ds-surface-container-highest)] px-4 py-3 text-sm shadow-lg", t.tone === "danger" ? "text-[var(--ds-color-danger-300)]" : "text-[var(--ds-on-surface)]")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
