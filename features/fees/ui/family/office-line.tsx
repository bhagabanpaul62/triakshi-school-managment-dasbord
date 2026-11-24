import { Panel } from "@smw/ui/kit/Panel";

/** Where and when to pay at the school: always shown, so a family never has to guess how to pay when UPI is off. */
export function OfficeLine({ school, hours }: { school: { name: string; phone: string | null; address: string | null }; hours?: string | null }) {
  return (
    <Panel title="Pay at the school office">
      <p className="text-sm">{hours ? <>Office hours: {hours}. </> : null}{school.phone ? <>Call <a href={`tel:${school.phone}`} className="underline underline-offset-4">{school.phone}</a>{hours ? "" : " to ask about office hours"}.</> : hours ? null : "Ask the class teacher or the front desk for the office hours."}</p>
      {school.address ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{school.name}, {school.address}</p> : null}
      <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">You get a receipt on the spot. It also appears on this page.</p>
    </Panel>
  );
}
