import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { DomainAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Timeline } from "@smw/ui/finance/Timeline";
import { dateTime, shortDate } from "@smw/ui/format";
import { EVENT_TEXT } from "@smw/feature-domains/state";
import { DOMAIN_LABELS, DOMAIN_TONES } from "@/lib/tones";
import { allowDomain, checkDomain, releaseDomain } from "../actions";
import { HEALTH_LABELS, HEALTH_TONES } from "../parts";

export const metadata = { title: "Domain" };

export default async function DomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  let d;
  try { d = await new DomainAdminService(staff).get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const canAct = staff.role === "owner" || staff.role === "support";
  return (
    <>
      <Link href="/domains" className="inline-flex min-h-10 items-center pb-2 text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">← All domains</Link>
      <PageHeader eyebrow="Domain" title={<span className="break-all font-mono text-[22px] sm:text-[28px]">{d.hostname}</span>}
        description={<>For <Link className="text-[var(--ds-primary-text)] hover:underline" href={`/schools/${d.schoolId}?tab=domains`}>{d.schoolName}</Link>{d.kind === "subdomain" ? ". This is the free address." : "."}</>}
        actions={canAct && d.kind === "custom" ? (
          <>
            <ActionButton label="Check now" variant="default" action={checkDomain} values={{ id }} />
            {d.staffReleased ? <ActionButton label="Allow the school to check again" variant="secondary" action={allowDomain} values={{ id }} confirm={{ title: "Allow this domain again?", body: `${d.schoolName} will be able to press Check now on ${d.hostname}. It goes live only if its records check out.`, confirmLabel: "Allow" }} /> : null}
            {d.status !== "failed" || d.verifiedAt ? (
              <FormModal title={`Release ${d.hostname}`} icon="domain" size="sm" action={releaseDomain} hidden={{ id }} submitLabel="Release" trigger={{ label: d.status === "verified" ? "Release" : "End claim", variant: "secondary", plus: false }}
                description="The domain stops opening the school and its main address moves to the free one. The school is shown your reason."
                fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, wide: true, placeholder: "The owner of the domain asked us to release it." }]} summary="The school's admins are told" />
            ) : null}
          </>
        ) : undefined} />
      <div className="flex flex-col gap-3">
        <Panel title="Now">
          <FactList>
            <Fact label="Status"><ToneBadge label={DOMAIN_LABELS[d.status] ?? d.status} tone={DOMAIN_TONES[d.status]} /></Fact>
            <Fact label="Health">{d.health ? <ToneBadge label={HEALTH_LABELS[d.health]} tone={HEALTH_TONES[d.health]} /> : null}</Fact>
            <Fact label="Main domain">{d.isPrimary ? "Yes" : "No"}</Fact>
            <Fact label="DNS provider">{d.dnsProvider}</Fact>
            <Fact label="Certificate until">{d.certExpiresAt ? shortDate(d.certExpiresAt) : null}</Fact>
            <Fact label="Last checked">{d.lastCheckedAt ? dateTime(d.lastCheckedAt) : null}</Fact>
            <Fact label="Failing since">{d.failingSince ? dateTime(d.failingSince) : null}</Fact>
            <Fact label="TXT missing since">{d.txtMissingSince ? dateTime(d.txtMissingSince) : null}</Fact>
            <Fact label="Problem" wrap>{d.checkError}</Fact>
          </FactList>
        </Panel>
        {d.kind === "custom" ? (
          <Panel title="Each record">
            {d.records.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">Not checked yet.</p> : (
              <FactList>
                {d.records.map((r) => (
                  <Fact key={r.key} label={r.key.toUpperCase()} wrap>
                    <ToneBadge label={r.ok ? "Right" : "Not right"} tone={r.ok ? "success" : "danger"} /> expected {r.expected}; found {r.found.length ? r.found.join(", ") : "nothing"}{r.note ? `. ${r.note}` : ""}
                  </Fact>
                ))}
              </FactList>
            )}
          </Panel>
        ) : null}
        <Panel title="What happened">
          <Timeline emptyText="Nothing has happened yet." items={d.events.map((e) => ({ at: e.createdAt.toISOString(), title: EVENT_TEXT[e.kind]?.title ?? e.kind, meta: [e.detail, e.byName ? `by ${e.byName}` : null].filter(Boolean).join(" · ") || undefined, tone: ["failing", "failed", "released", "lost"].includes(e.kind) ? "danger" : e.kind === "verified" || e.kind === "recovered" ? "success" : "default" }))} />
        </Panel>
      </div>
    </>
  );
}
