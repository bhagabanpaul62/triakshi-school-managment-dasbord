import type { ReactNode } from "react";

/** The centred card both login steps sit in. */
export function AuthCard({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">{title}</h1>
        {intro ? <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{intro}</p> : null}
        {children}
      </section>
    </main>
  );
}
