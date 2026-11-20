import { redirect } from "next/navigation";
import { getSchool, getSession } from "@smw/runtime";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata() {
  const s = await getSchool();
  return { title: `Forgot password · ${s.name}` };
}

export default async function ForgotPasswordPage() {
  const [school, session] = await Promise.all([getSchool(), getSession()]);
  if (session) redirect("/app");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-6 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Forgot password</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">{school.name}</h1>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Enter your login. If we have an email for it, we email a 6-digit code and a link to set a new password.</p>
        <ForgotForm />
      </section>
    </main>
  );
}
