import { redirect } from "next/navigation";
import { getSchool, getSession } from "@smw/runtime";
import { logout } from "@/lib/auth-actions";
import { ChangePasswordForm } from "@smw/feature-settings/ui/change-password-form";

export const metadata = { title: "Choose a new password" };

/** Outside the (panel) group on purpose: the panel gate sends people here, so it must not gate itself. */
export default async function ChangePasswordPage() {
  const [school, session] = await Promise.all([getSchool(), getSession()]);
  if (!session) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/app");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-6 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{school.name}</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Hello {session.user.name.split(/\s+/)[0]}. Your password was set by the school, so pick one only you know before you continue.</p>
        <ChangePasswordForm />
        <form action={logout} className="mt-4 text-center">
          <button type="submit" className="py-1 text-sm text-[var(--ds-on-surface-variant)] underline underline-offset-4 hover:text-[var(--ds-on-surface)]">Sign out</button>
        </form>
      </section>
    </main>
  );
}
