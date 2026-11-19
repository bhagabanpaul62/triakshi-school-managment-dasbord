import { redirect } from "next/navigation";
import { getSchool, getSession } from "@smw/runtime";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const s = await getSchool();
  return { title: `Sign in · ${s.name}` };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [school, session] = await Promise.all([getSchool(), getSession()]);
  if (session) redirect("/app");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Sign in</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">{school.name}</h1>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Staff, students and parents use the login their school gave them.</p>
        <LoginForm next={next} />
      </section>
    </main>
  );
}
