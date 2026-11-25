import Link from "next/link";

/** A refused page says in plain words what happened and who can help, and leaves a way home. */
export function NoAccess({ title = "You cannot open this page.", hint = "Ask your school admin if you need it." }: { title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl bg-white/[0.035] p-6">
      <p className="text-sm text-[var(--ds-on-surface)]">{title}</p>
      <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p>
      <Link href="/app" className="mt-2 inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Back to home</Link>
    </div>
  );
}
