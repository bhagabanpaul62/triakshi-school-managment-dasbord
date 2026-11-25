import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { EmptyLine } from "@smw/ui/finance/States";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { SUPPRESSION_TEXT } from "../email-health";
import { DeliveryService } from "../delivery";
import { allowAddressAgain, retryFailedDeliveries } from "./delivery-actions";

export const metadata = { title: "Delivery" };

const CHANNEL = { push: "Phone alerts", email: "Email" } as const;
const STATES = [["sent", "Sent"], ["pending", "Waiting"], ["failed", "Failed"], ["skipped", "Not sent"], ["bounced", "Refused"]] as const;
const TONE = { sent: "success", pending: "default", failed: "danger", skipped: "default", bounced: "warning" } as const;
const WHY = { failed: "Failed", skipped: "Not sent", bounced: "Refused" } as const;

export default async function DeliveryPage() {
  const ctx = await requireCtx();
  const svc = new DeliveryService(ctx);
  if (!svc.can("delivery")) {
    return (
      <>
        <PageHeader eyebrow="Communication" title="Delivery" />
        <EmptyLine title="Only the school admin can see delivery." hint="Ask your admin if an email or alert did not arrive." action={<Link href="/app" className="text-sm text-[var(--ds-color-primary-400)] hover:underline">Back to home</Link>} />
      </>
    );
  }
  const [s, blocked] = await Promise.all([svc.summary(), svc.suppressed()]);
  const n = (channel: string, state: string) => s.byChannel.find((r) => r.channel === channel && r.state === state)?.n ?? 0;
  const soft = "text-[var(--ds-on-surface-muted)]";

  return (
    <>
      <PageHeader eyebrow="Communication" title="Delivery" description="What was sent in the last 7 days, what did not go, and why."
        actions={s.failedCount ? <ActionButton action={retryFailedDeliveries} label={`Try ${s.failedCount} failed again`} /> : null} />
      <div className="flex flex-col gap-3">
        <Panel title="Email allowance today">
          <p className="text-3xl font-light tabular-nums text-[var(--ds-on-surface)]">{s.quota.left} <span className={`text-base ${soft}`}>left of {s.quota.forNotices}</span></p>
          <p className={`mt-2 text-sm ${soft}`}>All schools share {s.quota.limit} emails a day. {s.quota.limit - s.quota.forNotices} are kept for sign-in codes and passwords. Your school has used {s.quota.schoolUsed} today.</p>
          {s.waiting ? <p className="mt-2 text-sm text-[var(--ds-on-surface)]">{s.waiting} {s.waiting === 1 ? "email" : "emails"} will go tomorrow morning because today&apos;s limit was reached. Nothing is lost.</p> : null}
        </Panel>

        <Panel title="Last 7 days">
          <div className="flex flex-col gap-4">
            {(["push", "email"] as const).map((c) => (
              <div key={c}>
                <p className="mb-2 text-sm font-medium text-[var(--ds-on-surface)]">{CHANNEL[c]}</p>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {STATES.map(([state, label]) => (
                    <div key={state} className="rounded-xl bg-white/[0.035] p-3">
                      <dt className={`text-xs ${soft}`}>{label}</dt>
                      <dd className="mt-1 text-xl font-light tabular-nums text-[var(--ds-on-surface)]">{n(c, state)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {!s.byChannel.length ? <p className={`text-sm ${soft}`}>Nothing was sent yet. Alerts and emails appear here as notices, messages and reminders go out.</p> : null}
          </div>
        </Panel>

        <Panel title="Why things did not go">
          {s.problems.length ? (
            <ul className="flex flex-col">
              {s.problems.map((p) => (
                <li key={`${p.channel}${p.state}${p.reason}`} className="flex items-start gap-3 py-2.5">
                  <ToneBadge label={WHY[p.state as keyof typeof WHY]} tone={TONE[p.state as keyof typeof TONE]} />
                  <p className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface)]">{p.reason} <span className={soft}>({CHANNEL[p.channel as keyof typeof CHANNEL]})</span></p>
                  <span className="text-sm tabular-nums text-[var(--ds-on-surface)]">{p.n}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyLine title="Nothing failed in the last 7 days." />}
        </Panel>

        <Panel title="Addresses that stopped working">
          {blocked.length ? (
            <ul className="flex flex-col">
              {blocked.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--ds-on-surface)]">{b.address}</p>
                    <p className={`text-xs ${soft}`}>{SUPPRESSION_TEXT[b.reason]}</p>
                  </div>
                  <ActionButton action={allowAddressAgain} values={{ address: b.address }} label="Works again" variant="ghost"
                    confirm={{ title: "This address works again?", body: `Emails to ${b.address} will start again. If it still fails, it will be stopped again.`, confirmLabel: "Yes, send again" }} />
                </li>
              ))}
            </ul>
          ) : <EmptyLine title="No address is blocked." hint="If a person's mailbox refuses our mail, it shows up here and we stop trying." />}
        </Panel>
      </div>
    </>
  );
}
