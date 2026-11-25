import { notFound } from "next/navigation";
import { getSchool, requireCtx } from "@smw/runtime";
import { NotFoundError } from "@smw/feature-kit";
import { env } from "@smw/config";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { healthyMain } from "@smw/runtime/host";
import { Button } from "@smw/ui/ui/button";
import Link from "next/link";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Timeline } from "@smw/ui/finance/Timeline";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { dnsInstructions, sitesIp, type DnsRecord } from "../hostname";
import { GUIDES, itNote, type ProviderKey } from "../providers";
import { DomainService } from "../service";
import { EVENT_TEXT, domainState } from "../state";
import { checkDomainNow, removeDomain, setPrimaryDomain } from "./actions";
import { removeFields } from "./fields";
import { ItNote } from "./it-note";
import { Crumb, StateChip, certText, dateTime } from "./parts";

export const metadata = { title: "Domain" };

const STEP_TITLE: Record<string, string> = { txt: "Prove the domain is yours", cname: "Point it to us", a: "Point it to us", https: "Secure it with HTTPS" };

export default async function DomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const school = await getSchool();
  const svc = new DomainService(ctx);
  if (!svc.can("read")) return <NoAccess title="Domains are for school administrators." hint="Ask your school admin if the address needs a change." />;
  let d, events, block;
  try { [d, events, block] = await Promise.all([svc.get(id), svc.events(id), svc.staffBlock(id)]); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const canManage = svc.can("manage") && !ctx.readOnly;
  const canCheck = canManage && !block;
  const dns = dnsInstructions(d, env().ROOT_DOMAIN, sitesIp());
  const st = domainState(d);
  const provider: ProviderKey = (d.dnsProvider as ProviderKey | null) && d.dnsProvider! in GUIDES ? (d.dnsProvider as ProviderKey) : "other";
  const guide = GUIDES[provider];
  const note = itNote({ school: school.name, hostname: d.hostname, records: dns.records, provider });
  const checked = new Map(d.records.map((r) => [r.key, r]));
  const cert = certText(d);
  const live = d.status === "verified";
  const checkLabel = live ? "Check again" : d.status === "failed" ? "Check again" : "Check now";

  const rows: { rec: DnsRecord | null; key: string; expected: string }[] = [
    ...dns.records.map((rec) => ({ rec, key: rec.key, expected: rec.value })),
    { rec: null, key: "https", expected: "A valid certificate" },
  ];

  return (
    <>
      <Crumb href="/app/domains">All domains</Crumb>
      <PageHeader eyebrow="Domain" title={<span className="break-all font-mono text-[22px] sm:text-[28px]">{d.hostname}</span>} description={st.sentence}
        actions={canCheck ? (
          <>
            <ActionButton variant={st.next === "main" ? "secondary" : "default"} label={checkLabel} action={checkDomainNow} values={{ id: d.id }} />
            {live && !d.isPrimary && healthyMain(d) ? <ActionButton variant="default" label="Make main domain" action={setPrimaryDomain} values={{ id: d.id }} /> : null}
          </>
        ) : undefined} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StateChip d={d} />
          {d.isPrimary && live ? <ToneBadge label="Main domain" tone="info" /> : null}
          {cert ? <ToneBadge label={cert} tone={d.records.some((r) => r.key === "https" && !r.ok) || (d.health === "warning" && d.certExpiresAt) ? "warning" : "default"} /> : null}
          {d.lastCheckedAt ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Last checked {dateTime(d.lastCheckedAt)}</span> : <span className="text-xs text-[var(--ds-on-surface-muted)]">Not checked yet</span>}
        </div>

        {block ? (
          <Panel title="Released by Triakshi">
            <p className="pb-3 text-sm text-[var(--ds-on-surface-variant)]">Released by Triakshi: {block} Check now is off until support allows it again.</p>
            <Button asChild className="rounded-full"><Link href="/app/support/new">Ask support</Link></Button>
          </Panel>
        ) : null}

        {d.status === "failed" && d.verifiedAt && !block ? (
          <Panel title="This domain no longer opens your school">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">Your free address is the main address again. {canManage ? "Fix the records below and press Check again to bring it back." : "Ask your administrator to fix the records below."}</p>
          </Panel>
        ) : null}

        <Panel title="The records, one by one">
          <ol className="flex flex-col gap-5">
            {rows.map((row, i) => {
              const res = checked.get(row.key as "txt" | "cname" | "a" | "https");
              const state = !res ? "waiting" : res.ok ? "ok" : "bad";
              return (
                <li key={row.key} className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-xs">{i + 2}</span>
                    <h3 className="text-sm font-medium">{STEP_TITLE[row.key]}</h3>
                    <ToneBadge label={state === "ok" ? "Found" : state === "bad" ? "Not right yet" : "Not checked yet"} tone={state === "ok" ? "success" : state === "bad" ? "danger" : "default"} />
                  </div>
                  <FactList>
                    {row.rec ? (
                      <>
                        <Fact label="Type">{row.rec.type}</Fact>
                        <Fact label="Name" copy={row.rec.short}><span className="font-mono">{row.rec.short}</span></Fact>
                        <Fact label="Value" copy={row.rec.value}><span className="font-mono">{row.rec.value}</span></Fact>
                      </>
                    ) : <Fact label="Needs" wrap>A valid certificate. It is issued by itself once the address points to us, on the first visit.</Fact>}
                    <Fact label="We found" wrap>{res && res.found.length ? res.found.join(", ") : res ? "Nothing yet" : "Nothing checked yet"}</Fact>
                    {res?.note ? <Fact label="Note" wrap>{res.note}</Fact> : null}
                  </FactList>
                  {row.rec && row.rec.short !== row.rec.name ? <p className="px-2 text-xs text-[var(--ds-on-surface-muted)]">Some registrars want the full name instead: <CopyValue value={row.rec.name} label="full record name" maxWidth="40ch" /></p> : null}
                </li>
              );
            })}
          </ol>
          {dns.notes.map((n) => <p key={n} className="pt-4 text-[13px] text-[var(--ds-on-surface-muted)]">{n}</p>)}
        </Panel>

        {!(live && d.health === "ok") ? (
          <Panel title={d.dnsProvider ? `How to add them at ${guide.name}` : "How to add them"}>
            <p className="pb-2 text-sm text-[var(--ds-on-surface-variant)]">{d.dnsProvider && provider !== "other" ? `Your domain looks like it is managed at ${guide.name}. ` : "We tell who runs your DNS after the first check. "}{guide.where}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--ds-on-surface-variant)]">{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            {guide.warning ? <p role="note" className="mt-3 rounded-xl bg-[var(--ds-color-warning-500)]/10 p-3 text-sm text-[var(--ds-color-warning-300)]">{guide.warning}</p> : null}
          </Panel>
        ) : null}

        {!live ? (
          <Panel title="Send to my IT person">
            <p className="pb-3 text-sm text-[var(--ds-on-surface-variant)]">Someone else looks after your domain? Send them this message. It has exactly what to add.</p>
            <ItNote subject={note.subject} body={note.body} />
          </Panel>
        ) : null}

        <Panel title="What happened">
          <Timeline emptyText="Nothing has happened yet." items={events.map((e) => ({
            at: e.createdAt.toISOString(), title: EVENT_TEXT[e.kind]?.title ?? e.kind, tone: EVENT_TEXT[e.kind]?.tone,
            meta: [e.detail, e.byName ? `by ${e.byName}` : null].filter(Boolean).join(" · ") || undefined,
          }))} />
        </Panel>

        {canManage ? (
          <Panel title="Remove this domain">
            <p className="pb-3 text-sm text-[var(--ds-on-surface-variant)]">{live ? "Your school stops opening on this address right away. Your free address keeps working." : "We stop checking this domain. You can add it again later."}</p>
            {live
              ? <FormModal title={`Remove ${d.hostname}`} icon="domain" fields={removeFields(d.hostname)} hidden={{ id: d.id }} action={removeDomain} submitLabel="Remove domain" size="sm" trigger={{ label: "Remove domain", variant: "ghost", plus: false }} redirectTo="/app/domains" successMessage="Domain removed" />
              : <ActionButton label="Remove domain" variant="ghost" action={removeDomain} values={{ id: d.id }} redirectTo="/app/domains" confirm={{ title: `Remove ${d.hostname}?`, body: "We stop checking this domain. You can add it again later.", confirmLabel: "Remove", danger: true }} />}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
