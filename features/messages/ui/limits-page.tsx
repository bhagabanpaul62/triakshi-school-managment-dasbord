import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { RESTRICTION_WORDS } from "../constants";
import { SafeguardService } from "../safeguard";
import { LiftButton, RestrictForm } from "./safeguard-forms";
import { SafeguardNav } from "./safeguarding-page";

import { NoSupport } from "./empty";
export const metadata = { title: "Message limits" };

async function LimitsPage() {
  const ctx = await requireCtx();
  if (ctx.supportStaffId) return <NoSupport />;
  const rows = await new SafeguardService(ctx).restrictions();
  return (
    <>
      <PageHeader eyebrow="Safeguarding" title="Message limits" description="Limit a family login or a staff member until a date. They are told, with the reason." />
      <SafeguardNav here="/app/safeguarding/limits" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Set a limit"><RestrictForm /></Panel>
        <Panel title="Limits">
          {rows.length ? (
            <ul className="flex flex-col gap-3">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><span className="block">{r.name} <span className="text-xs text-[var(--ds-on-surface-muted)]">{r.active ? "" : "(ended)"}</span></span>
                    <span className="block text-xs text-[var(--ds-on-surface-muted)]">{RESTRICTION_WORDS[r.kind]}, until {shortDate(r.until)}. {r.reason}</span></span>
                  {r.active ? <LiftButton id={r.id} /> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">No limits set. Use the form to limit someone who is misusing messages.</p>}
        </Panel>
      </div>
    </>
  );
}

export default function Page(...a: Parameters<typeof LimitsPage>) { return refusalOr(() => LimitsPage(...a)); }
