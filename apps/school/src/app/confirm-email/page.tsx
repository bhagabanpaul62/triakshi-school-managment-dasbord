import Link from "next/link";
import { SchoolAuth } from "@smw/auth";
import { getSchool } from "@smw/runtime";
import { ConfirmForm } from "./confirm-form";

export const metadata = { title: "Confirm your new email" };

const PROBLEM = {
  used: { title: "This link was already used", body: "Your email is already confirmed. Check it on your profile." },
  expired: { title: "This link has expired", body: "Links work for 24 hours. Change your email again from your profile to get a new one." },
  unknown: { title: "This link is not valid", body: "Open the email again and use its button, or change your email again from your profile." },
} as const;

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [school, { token }] = await Promise.all([getSchool(), searchParams]);
  const peek = token ? await new SchoolAuth(school.id).peekToken("change_email", token) : { state: "unknown" as const };
  const email = peek.state === "ok" ? String((peek.meta as { email?: string }).email ?? "") : "";
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-6 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{school.name}</p>
        {peek.state === "ok" && token && email ? <ConfirmForm token={token} email={email} /> : (
          <>
            <h1 className="mt-4 text-2xl font-medium tracking-tight">{PROBLEM[peek.state === "ok" ? "unknown" : peek.state].title}</h1>
            <p role="alert" className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">{PROBLEM[peek.state === "ok" ? "unknown" : peek.state].body}</p>
            <Link href="/app/profile" className="mt-6 inline-flex h-11 items-center rounded-full bg-white/[0.08] px-6 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Go to my profile</Link>
          </>
        )}
      </section>
    </main>
  );
}
