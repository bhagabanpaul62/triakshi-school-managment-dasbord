import type { Metadata } from "next";
import Link from "next/link";
import { Tokens } from "@smw/auth";
import { and, eq, gt, isNull, oneTimeTokens, withSchool } from "@smw/db";
import { getSchool } from "@smw/runtime";
import { ResendForm } from "./resend-form";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [school, { token }] = await Promise.all([getSchool(), searchParams]);
  // Look only: the token is used up when the password form is submitted.
  const valid = token
    ? (await withSchool(school.id, (tx) => tx.select({ id: oneTimeTokens.id }).from(oneTimeTokens).where(and(
        eq(oneTimeTokens.tokenHash, Tokens.hash(token)), eq(oneTimeTokens.purpose, "verify_email"), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, new Date()),
      )).limit(1))).length > 0
    : false;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Confirm email</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">{school.name}</h1>
        {valid && token ? (
          <>
            <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Set a password for your admin account. Our team then reviews your school, usually within one business day, and emails you when it is approved.</p>
            <VerifyForm token={token} />
          </>
        ) : (
          <>
            <h2 className="mt-4 text-base font-medium">This link has expired or was already used</h2>
            <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Links work once and for 48 hours. Already set your password? <Link href="/login" className="text-[var(--ds-on-surface)] underline underline-offset-4">Sign in</Link>. If not, get a new link.</p>
            <ResendForm />
            <p className="mt-5 text-xs text-[var(--ds-on-surface-muted)]">Still stuck? Write to <a href="mailto:support@triakshi.com" className="underline underline-offset-4">support@triakshi.com</a>.</p>
          </>
        )}
      </section>
    </main>
  );
}
