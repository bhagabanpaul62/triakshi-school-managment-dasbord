import Link from "next/link";

/** Full-page message for not-found, paused and error states. */
export function StatusPage({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">{body}</p>
        {action ? <Link href={action.href} className="mt-6 inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm text-white">{action.label}</Link> : null}
      </section>
    </main>
  );
}
