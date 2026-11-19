import { getSchool } from "@smw/runtime";
import { initials } from "@smw/ui/format";
import { ResetPasswordCard, type CardState } from "./reset-password-card";
import { linkState } from "./reset-link";

export const metadata = { title: "Set your password" };

const PROBLEM = {
  used: { title: "This link was already used", body: "Your password is set. Sign in with it, or ask your school admin to send a new link if you forgot it." },
  expired: { title: "This link has expired", body: "Links work for a limited time. Ask your school admin to send you a new one." },
  unknown: { title: "This link is not valid", body: "Open the email again and use its button, or ask your school admin to send a new link." },
} as const;

/** The page the invite email links to. Public: it needs only the token in the link. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [school, { token }] = await Promise.all([getSchool(), searchParams]);
  const state = token ? await linkState(school.id, token) : null;
  const card: CardState = state?.ok && token
    ? { kind: "form", token, heading: state.kind === "invite" ? `Welcome, ${state.firstName}` : "Set a new password",
        intro: state.kind === "invite" ? "Choose a password to finish setting up your account. You will be signed in right after." : `Hello ${state.firstName}, choose a new password. You will be signed in right after.` }
    : { kind: "problem", ...(!state ? PROBLEM.unknown : state.ok ? PROBLEM.unknown : PROBLEM[state.reason]) };
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-[var(--ds-surface-container-low)] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          {school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own file route, not optimisable
            <img src={school.logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ds-color-primary-500)] text-sm font-medium text-white" aria-hidden>{initials(school.name)}</span>
          )}
          <p className="min-w-0 truncate text-sm text-[var(--ds-on-surface-variant)]">{school.name}</p>
        </div>
        <ResetPasswordCard state={card} />
      </section>
    </main>
  );
}
