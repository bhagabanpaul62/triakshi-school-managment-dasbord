import { getSchool } from "@smw/runtime";
import { Button } from "@smw/ui/ui/button";
import { startSupportSession } from "./actions";

export const metadata = { title: "Support sign-in" };

/**
 * Landing page for the console's support link. The token is only spent when the button is pressed,
 * so link previews and prefetching cannot use it up.
 */
export default async function SupportLoginPage({ searchParams }: { searchParams: Promise<{ token?: string; failed?: string }> }) {
  const [school, { token, failed }] = await Promise.all([getSchool(), searchParams]);
  const bad = !token || !!failed;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Support sign-in</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">{school.name}</h1>
        {bad ? (
          <>
            <p role="alert" className="mt-4 text-sm text-[var(--ds-on-surface-variant)]">
              {failed === "refused"
                ? "This school has asked that Triakshi does not sign in right now, so the link did not work. Ask the school's administrator to allow it in Settings, then make a new link."
                : "This link has expired or was already used. Ask the person who sent it to make a new one in the console. Links work once and only for five minutes."}
            </p>
            <a href="/login" className="mt-6 inline-flex h-11 items-center rounded-full bg-white/[0.07] px-5 text-sm">Go to sign-in</a>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">
              You are about to open this school&apos;s panel as Triakshi support. The session lasts 30 minutes and everything you do is logged.
            </p>
            <form action={startSupportSession} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className="h-11 w-full rounded-full">Open the panel</Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
