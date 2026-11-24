import Link from "next/link";
import { getSchool, requireCtx } from "@smw/runtime";
import { env } from "@smw/config";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel, Inset } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { type Tone } from "@smw/ui/tone";
import { Button } from "@smw/ui/ui/button";
import { MAX_DOMAINS, dnsInstructions } from "../hostname";
import { DomainService, type SchoolDomain } from "../service";
import { addDomain, checkDomainNow, removeDomain, setPrimaryDomain } from "./actions";
import { domainFields } from "./fields";

export const metadata = { title: "Domain" };

const STATUS: Record<SchoolDomain["status"], { label: string; tone: Tone }> = {
  pending: { label: "Waiting for DNS", tone: "warning" },
  verified: { label: "Live", tone: "success" },
  failed: { label: "Not verified", tone: "danger" },
};

/** The path every domain walks, shown so the admin always knows where they are and what comes next. */
function Steps({ status }: { status: SchoolDomain["status"] | "none" }) {
  const at = status === "verified" ? 4 : status === "none" ? 1 : 2;
  const steps = ["Add the domain", "Add two records at your registrar", "We verify it, every 10 minutes", "Live with HTTPS"];
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Setup steps">
      {steps.map((t, i) => (
        <li key={t} aria-current={i + 1 === at && status !== "verified" ? "step" : undefined} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${i + 1 <= at ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary,#000)]" : "bg-white/[0.08] text-[var(--ds-on-surface-muted)]"}`}>{i + 1}</span>
          <span className={i + 1 <= at ? "" : "text-[var(--ds-on-surface-muted)]"}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null);

export default async function DomainsPage() {
  const ctx = await requireCtx();
  const school = await getSchool();
  const svc = new DomainService(ctx);
  const [plan, domains] = await Promise.all([svc.planAllows(), svc.list()]);
  const canManage = svc.can("manage") && !ctx.readOnly;
  const sitesIp = process.env.SITES_IP || "203.0.113.10";
  const addButton = canManage && domains.length < MAX_DOMAINS
    ? <FormModal title="Add domain" icon="domain" fields={domainFields} action={addDomain} submitLabel="Add domain" size="sm" summary="Next: we show the two records to add where you bought the domain." /> : null;

  if (!plan.allowed) {
    return (
      <>
        <PageHeader eyebrow="Website" title="Your own domain" description="Show your school website and panel on an address like www.myschool.in." />
        <Panel title="Custom domains are on higher plans">
          <p className="max-w-xl text-sm text-[var(--ds-on-surface-variant)]">
            {plan.planName ? `Your ${plan.planName} plan does not include a custom domain.` : "Your current plan does not include a custom domain."} Upgrade to
            use your own address, with HTTPS included. Your school keeps working on its free address meanwhile.
          </p>
          <div className="pt-4"><Button asChild className="rounded-full"><Link href="/app/billing">See plans in Billing</Link></Button></div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Website" title="Your own domain" description="Add your domain, then add two records at the company where you bought it. We check every 10 minutes."
        actions={addButton} />
      {domains.length === 0 ? (
        <div><Panel title="Use your own address">
          <p className="max-w-xl pb-4 text-sm text-[var(--ds-on-surface-variant)]">Your school already opens on {`${school.slug}.${env().ROOT_DOMAIN}`}. Add the address you own, for example www.myschool.in, and parents can use that instead.</p>
          <Steps status="none" />
          {addButton ? <div className="pt-5">{addButton}</div> : <p className="pt-4 text-sm text-[var(--ds-on-surface-muted)]">Ask your administrator to add the domain.</p>}
        </Panel></div>
      ) : (
        <div className="flex flex-col gap-3">
          {domains.map((d) => {
            const s = STATUS[d.status];
            const dns = dnsInstructions(d, env().ROOT_DOMAIN, sitesIp);
            return (
              <Panel key={d.id} title={<span className="flex items-center gap-2">{d.hostname}{d.isPrimary ? <ToneBadge label="Main domain" tone="info" /> : null}</span>}
                action={<ToneBadge label={s.label} tone={s.tone} />}>
                <div className="pb-4"><Steps status={d.status} /></div>
                {d.status === "verified" ? (
                  <p className="text-sm text-[var(--ds-on-surface-variant)]">Verified {when(d.verifiedAt)}. Your school opens at <a className="text-[var(--ds-primary)] hover:underline" href={`https://${d.hostname}`} target="_blank" rel="noopener">https://{d.hostname}</a>. The first visit can take a few seconds while the secure certificate is issued.</p>
                ) : (
                  <Inset>
                    <p className="pb-2 text-sm text-[var(--ds-on-surface-variant)]">Add {dns.records.length === 2 ? "these two records" : "these records"} where you manage DNS for {d.hostname}:</p>
                    <FactList>
                      {dns.records.map((r) => (
                        <div key={r.type} className="pb-2">
                          <Fact label={`${r.type} name`} copy={r.name}>{r.name}</Fact>
                          <Fact label={`${r.type} value`} copy={r.value}>{r.value}</Fact>
                        </div>
                      ))}
                    </FactList>
                    {dns.notes.map((n) => <p key={n} className="px-2 pt-1 text-[13px] text-[var(--ds-on-surface-muted)]">{n}</p>)}
                  </Inset>
                )}
                {d.checkError && d.status !== "verified" ? <p role="status" className="pt-3 text-sm text-[var(--ds-color-danger-400)]">Not found yet: {d.checkError} Check the name and value match exactly, then press Check now.</p> : null}
                {d.lastCheckedAt && d.status !== "verified" ? <p className="pt-1 text-[13px] text-[var(--ds-on-surface-muted)]">Last checked {when(d.lastCheckedAt)}</p> : null}
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2 pt-4">
                    {d.status !== "verified" ? <ActionButton label="Check now" action={checkDomainNow} values={{ id: d.id }} successMessage="Checked. The status below is up to date" /> : null}
                    {d.status === "verified" && !d.isPrimary ? <ActionButton label="Make main domain" action={setPrimaryDomain} values={{ id: d.id }} /> : null}
                    <ActionButton label="Remove" variant="ghost" action={removeDomain} values={{ id: d.id }}
                      confirm={{ title: `Remove ${d.hostname}?`, body: d.status === "verified" ? "Your school will stop opening on this address right away. Your free address keeps working." : "We will stop checking this domain. You can add it again later.", confirmLabel: "Remove", danger: true }} />
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
