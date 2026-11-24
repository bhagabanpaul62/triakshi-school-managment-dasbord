import { Panel } from "@smw/ui/kit/Panel";

/** Where to pay when UPI is off or has no ID: never a dead button. */
export function OfficeLine({ school }: { school: { name: string; phone: string | null; address: string | null } }) {
  return (
    <Panel title="Pay at the school office">
      <p className="text-sm">Pay at the school office. {school.phone ? <>Call <a href={`tel:${school.phone}`} className="underline underline-offset-4">{school.phone}</a> to ask about office hours.</> : "Ask the class teacher or the front desk for the office hours."}</p>
      {school.address ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{school.name}, {school.address}</p> : null}
      <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">You get a receipt on the spot. It also appears on this page.</p>
    </Panel>
  );
}
