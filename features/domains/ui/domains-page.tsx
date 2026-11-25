import Link from "next/link";
import { getSchool, requireCtx } from "@smw/runtime";
import { env } from "@smw/config";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { MAX_DOMAINS } from "../hostname";
import { DomainService } from "../service";
import { domainState, redirectSentence } from "../state";
import { addDomain, checkDomainNow, setPrimaryDomain, setRedirectToMain } from "./actions";
import { domainFields } from "./fields";
import { StateChip, certText, dateTime } from "./parts";

export const metadata = { title: "Domain" };

/** The path every domain walks, shown so the admin always knows where they are and what comes next. */
function Steps({ at }: { at: 1 | 2 | 3 | 4 }) {
  const steps = ["Add the domain", "Add the records at your registrar", "We check them, every 10 minutes", "Live with HTTPS"];
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Setup steps">
      {steps.map((t, i) => (
        <li key={t} aria-current={i + 1 === at && at < 4 ? "step" : undefined} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${i + 1 <= at ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary,#000)]" : "bg-white/[0.08] text-[var(--ds-on-surface-muted)]"}`}>{i + 1}</span>
          <span className={i + 1 <= at ? "" : "text-[var(--ds-on-surface-muted)]"}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function DomainsPage() {
  const ctx = await requireCtx();
  const school = await getSchool();
  const svc = new DomainService(ctx);
  if (!svc.can("read")) return <NoAccess title="Domains are for school administrators." hint="Ask your school admin if the address needs a change." />;
  const [plan, domains, free] = await Promise.all([svc.planAllows(), svc.list(), svc.free()]);
  const blocked = new Set((await Promise.all(domains.filter((d) => d.status === "failed").map(async (d) => ((await svc.staffBlock(d.id)) ? d.id : null)))).filter((x): x is string => !!x));
  const canManage = svc.can("manage") && !ctx.readOnly;
  const freeHost = `${school.slug}.${env().ROOT_DOMAIN}`;
  const main = domains.find((d) => d.isPrimary && d.status === "verified") ?? null;
  const live = domains.filter((d) => d.status === "verified");
  const canAdd = plan.allowed && domains.length < MAX_DOMAINS;
  const addButton = canManage && canAdd
    ? <FormModal title="Add domain" icon="domain" fields={domainFields} action={addDomain} submitLabel="Add domain" size="sm" summary="Next: we show the records to add where you bought the domain." /> : null;

  if (!plan.allowed && domains.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Website" title="Your own domain" description="Show your school website and panel on an address like www.myschool.in." />
        <Panel title="Custom domains are on higher plans">
          <p className="max-w-xl text-sm text-[var(--ds-on-surface-variant)]">
            {plan.planName ? `Your ${plan.planName} plan does not include a custom domain.` : "Your current plan does not include a custom domain."} Upgrade to
            use your own address, with HTTPS included. Your school keeps working on {freeHost} meanwhile.
          </p>
          <div className="pt-4">{canManage ? <Button asChild className="rounded-full"><Link href="/app/billing">See plans in Billing</Link></Button> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Ask your administrator to upgrade the plan in Billing.</p>}</div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Website" title="Your own domain" description="Add your domain, then add the records at the company where you bought it. We check every 10 minutes." actions={domains.length ? addButton : null} />
      {!plan.allowed ? (
        <div className="pb-3"><Panel title="Your plan no longer includes new domains">
          <p className="max-w-xl text-sm text-[var(--ds-on-surface-variant)]">The domains below keep working. To add another, upgrade {canManage ? <Link className="text-[var(--ds-primary-text)] underline underline-offset-2" href="/app/billing">in Billing</Link> : "in Billing (ask your administrator)"}.</p>
        </Panel></div>
      ) : domains.length < MAX_DOMAINS ? null : (
        <div className="pb-3"><Panel title={`You have ${MAX_DOMAINS} domains`}><p className="text-sm text-[var(--ds-on-surface-variant)]">That is the most one school can have. Remove one to add another.</p></Panel></div>
      )}

      {domains.length === 0 ? (
        <Panel title="Use your own address">
          <p className="max-w-xl pb-4 text-sm text-[var(--ds-on-surface-variant)]">Your school already opens on {freeHost}. Add the address you own, for example www.myschool.in, and parents can use that instead.</p>
          <Steps at={1} />
          <div className="pt-5">{addButton ?? <p className="text-sm text-[var(--ds-on-surface-muted)]">Ask your administrator to add the domain.</p>}</div>
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          <Panel title="Your addresses">
            <ul className="flex flex-col divide-y divide-white/[0.06]">
              <li className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">{freeHost}</span>
                  <span className="block text-xs text-[var(--ds-on-surface-muted)]">Free address. Always works.</span>
                </span>
                {!main ? <ToneBadge label="Main domain" tone="info" /> : null}
                {main && free && canManage ? <ActionButton label="Make main" action={setPrimaryDomain} values={{ id: free.id }} confirm={{ title: "Use the free address as the main one?", body: `${main.hostname} keeps working, but visitors are no longer sent to it.`, confirmLabel: "Make main" }} /> : null}
              </li>
              {domains.map((d) => {
                const st = domainState(d), cert = certText(d);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/app/domains/${d.id}`} className="block truncate font-mono text-sm hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{d.hostname}</Link>
                      <span className="block text-xs text-[var(--ds-on-surface-muted)]">{[d.status === "verified" ? cert : d.lastCheckedAt ? `Last checked ${dateTime(d.lastCheckedAt)}` : "Not checked yet"].filter(Boolean).join(" · ")}</span>
                    </span>
                    {d.isPrimary && d.status === "verified" ? <ToneBadge label="Main domain" tone="info" /> : null}
                    <StateChip d={d} />
                    {canManage && st.next === "main" ? <ActionButton label="Make main" action={setPrimaryDomain} values={{ id: d.id }} /> : null}
                    {canManage && st.next === "retry" && !blocked.has(d.id) ? <ActionButton label="Check now" action={checkDomainNow} values={{ id: d.id }} /> : null}
                    <Button asChild variant={st.next === "fix" || st.next === "finish" ? "default" : "ghost"} className="rounded-full">
                      <Link href={`/app/domains/${d.id}`}>{st.next === "finish" ? "Finish setup" : st.next === "fix" ? "Fix it" : st.next === "retry" ? "See why" : "Open"}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Where visitors are sent" action={canManage && main ? (
            <ActionButton label={school.row.redirectToPrimary ? "Turn off" : "Turn on"} action={setRedirectToMain} values={{ on: school.row.redirectToPrimary ? "0" : "1" }}
              confirm={{ title: school.row.redirectToPrimary ? "Stop sending visitors to the main domain?" : "Send visitors to the main domain?", body: school.row.redirectToPrimary ? "Every address will show your website. Search engines may see the same pages twice." : "Visitors on the other addresses are sent on to your main domain. The panel and sign-in are never moved.", confirmLabel: school.row.redirectToPrimary ? "Turn off" : "Turn on" }} />
          ) : undefined}>
            <p className="max-w-2xl text-sm text-[var(--ds-on-surface-variant)]">
              {redirectSentence({ free: freeHost, main, others: [...live.filter((d) => d.id !== main?.id).map((d) => d.hostname), ...(main ? [freeHost] : [])], on: school.row.redirectToPrimary })}
            </p>
            <p className="pt-2 text-[13px] text-[var(--ds-on-surface-muted)]">Links in emails to families use the main domain while it is healthy, and the free address otherwise.</p>
          </Panel>
        </div>
      )}
    </>
  );
}
