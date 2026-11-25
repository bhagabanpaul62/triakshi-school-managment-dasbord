import type { ReactNode } from "react";
import { IconCheck } from "@tabler/icons-react";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { StatusRefresh } from "./status-refresh";

const SUPPORT_EMAIL = "support@triakshi.com";

type Stage = "done" | "now" | "later";

/**
 * Shown in place of the panel while the platform has not approved the school: calm, says what happens next,
 * and shows where the school is on the way in. Put the sign-out button in `children`.
 */
export function AwaitingApproval({ schoolName, status, email, supportEmail = SUPPORT_EMAIL, children }: {
  schoolName: string; status: "pending" | "rejected"; email?: string; supportEmail?: string; children?: ReactNode;
}) {
  const rejected = status === "rejected";
  const timeline: { label: string; text: string; stage: Stage; badge?: ReactNode }[] = [
    { label: "Registered", text: "We have your school's details.", stage: "done" },
    { label: "Email verified", text: "Your email address is confirmed.", stage: "done" },
    { label: "Approval", text: rejected ? "We could not approve this registration." : "We check your school's details.", stage: "now",
      badge: rejected ? <ToneBadge label="Not approved" tone="danger" /> : <ToneBadge label="In progress" tone="info" /> },
    { label: "Set up your school", text: "Add classes, students and your website. It takes about 20 minutes.", stage: "later" },
  ];
  return (
    <main className="flex min-h-dvh items-center justify-center p-4 sm:p-6">
      <section className="w-full max-w-xl rounded-3xl bg-[var(--ds-surface-container-low)] p-6 sm:p-8" aria-labelledby="awaiting-title">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{schoolName}</p>
        <h1 id="awaiting-title" className="mt-2 text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]">
          {rejected ? "We could not approve your school yet" : "Your school is being reviewed"}
        </h1>
        {rejected ? (
          <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">
            This usually means a detail did not match, or something was missing. Write to <a href={`mailto:${supportEmail}`} className="text-[var(--ds-primary-text)] underline">{supportEmail}</a> with
            your school name and we will look at it again. Nothing you entered has been lost.
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">
            We check every school by hand before it opens, usually within one business day. You will get an email{email ? <> at <span className="text-[var(--ds-on-surface)]">{email}</span></> : null} as soon
            as it is done. You do not need to wait on this page.
          </p>
        )}
        <ol className="mt-7 flex flex-col" aria-label="Where your school is">
          {timeline.map((t, i) => (
            <li key={t.label} className="flex gap-4" aria-current={t.stage === "now" ? "step" : undefined}>
              <div className="flex flex-col items-center">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${t.stage === "done" ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : t.stage === "now" ? "bg-white/[0.16] text-[var(--ds-on-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-muted)]"}`}>
                  {t.stage === "done" ? <IconCheck className="h-4 w-4" aria-label="Done" /> : i + 1}
                </span>
                {i < timeline.length - 1 ? <span className="my-1 w-px flex-1 bg-white/[0.08]" aria-hidden /> : null}
              </div>
              <div className="pb-5">
                <p className={`flex flex-wrap items-center gap-2 text-sm ${t.stage === "later" ? "text-[var(--ds-on-surface-muted)]" : "text-[var(--ds-on-surface)]"}`}>{t.label}{t.badge}</p>
                <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{t.text}</p>
              </div>
            </li>
          ))}
        </ol>
        {rejected ? null : (
          <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">This page updates by itself once we approve. Questions in the meantime? Write to <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a>.</p>
        )}
        {children || !rejected ? <div className="mt-6 flex flex-wrap items-center gap-3">{rejected ? null : <StatusRefresh />}{children}</div> : null}
      </section>
    </main>
  );
}
