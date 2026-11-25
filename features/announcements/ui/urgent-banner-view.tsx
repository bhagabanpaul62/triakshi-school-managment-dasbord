"use client";

import { usePathname } from "next/navigation";
import type { ClosureLine } from "./urgent-banner";

/** The red banner itself. It hides an alert on that alert's own page: the person is already reading it. */
export function UrgentBannerView({ alerts, closures, home }: { alerts: { id: string; title: string; asksAnswer: boolean }[]; closures: ClosureLine[]; home: string }) {
  const path = usePathname();
  const shown = alerts.filter((a) => path !== `${home}/${a.id}`);
  if (!shown.length && !closures.length) return null;
  return (
    <div role="alert" className="mb-4 flex flex-col gap-1 rounded-3xl bg-[var(--ds-color-danger-500)]/15 p-4 text-sm text-[var(--ds-color-danger-300)]">
      {shown.map((a) => (
        <a key={a.id} href={`${home}/${a.id}`} className="flex min-h-10 flex-wrap items-center gap-x-2 font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
          <span>Urgent alert: {a.title}</span><span className="font-normal">{a.asksAnswer ? "Open it to tell the school you are safe." : "Open it to read it."}</span>
        </a>
      ))}
      {closures.map((c) => <p key={c.key} className="flex min-h-10 flex-wrap items-center gap-x-2 font-medium">{c.text}</p>)}
    </div>
  );
}
