import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { SupportAccessService } from "../access-service";
import { readSupportAccess, setSupportAccess } from "./data-actions";
import { AdminOnly } from "./states";

export const metadata = { title: "Support access" };

const MODE_LABEL = { always: "Always allowed", until: "Allowed for a while", never: "Never" } as const;

/** Whether Triakshi may open the school, and every time they did. */
export default async function AccessPage() {
  const ctx = await requireCtx();
  const svc = new SupportAccessService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Support access" />;
  if (ctx.supportStaffId) return <Panel><WidgetEmptyState title="Not available in a support session." description="Only the school decides who may open it." /></Panel>;
  const [state, visits] = await Promise.all([svc.state(), svc.visits()]);
  return (
    <>
      <PageHeader eyebrow="Your data" title="Support access" description="Triakshi staff can open your school to help you. You decide when. Every visit is listed here, and you are told when one starts."
        actions={ctx.readOnly ? <p className="max-w-xs text-xs text-[var(--ds-on-surface-muted)]">Your school is read-only, so this cannot be changed now.</p> : <FormModal title="Who may open my school" icon="shield" description="This takes effect at once. A visit that is open now ends the next time it asks for a page."
          fields={[{ name: "mode", label: "Triakshi may open my school", type: "select", required: true, wide: true, options: [
            { value: "always", label: "Always, when needed to help me" }, { value: "24h", label: "Only when I allow it: for 24 hours from now" },
            { value: "72h", label: "Only when I allow it: for 72 hours from now" }, { value: "never", label: "Never" }] }]}
          values={{ mode: state.mode === "until" ? "24h" : state.mode }} action={setSupportAccess} trigger={{ label: "Change", plus: false }} />} />
      <div className="flex flex-col gap-6">
        <Panel title="Right now" action={<ToneBadge label={MODE_LABEL[state.mode]} tone={state.open ? "warning" : "success"} />}>
          <p className="text-sm text-[var(--ds-on-surface)]">{state.words}</p>
          {state.until && state.open ? <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Until {dateTime(state.until)}.</p> : null}
          {state.mode === "always" ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">This is how every school starts. Choose another setting if you prefer to allow visits one at a time.</p> : null}
          <form action={readSupportAccess} className="mt-3"><button type="submit" className={PILL_BTN}>I have read this</button></form>
          <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">If something is wrong with your school and you have blocked access, an owner of Triakshi can still enter with a written reason. That is always listed below and you are told.</p>
        </Panel>
        <Panel title="Every visit" action={<Link href="/app/audit?support=1" className={PILL_BTN}>Everything support changed</Link>}>
          {visits.length === 0 ? <WidgetEmptyState title="Nobody from Triakshi has opened your school." description="When they do, each visit is listed here with who, why and for how long." /> : (
            <div className="relative overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="py-2 font-normal">When</th><th className="py-2 font-normal">Who</th><th className="py-2 font-normal">As</th><th className="py-2 font-normal">Why</th><th className="py-2 font-normal">Kind</th><th className="py-2 text-right font-normal">Changes</th></tr></thead>
              <tbody>
                {visits.map((v) => {
                  const day = (v.enteredAt ?? v.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                  return (
                    <tr key={v.id} className="border-t border-white/[0.05] align-top">
                      <td className="py-2.5 pr-3 tabular-nums text-[var(--ds-on-surface-variant)]">{dateTime(v.enteredAt ?? v.createdAt)}{v.enteredAt ? "" : <span className="block text-xs text-[var(--ds-on-surface-muted)]">link made, not used</span>}</td>
                      <td className="py-2.5 pr-3 text-[var(--ds-on-surface)]">{v.staffName}</td>
                      <td className="py-2.5 pr-3 text-[var(--ds-on-surface-variant)]">{v.asUserName}</td>
                      <td className="max-w-[16rem] break-words py-2.5 pr-3 text-[var(--ds-on-surface-variant)]">{v.reason}</td>
                      <td className="py-2.5 pr-3"><span className="flex flex-wrap gap-1"><ToneBadge label={v.readOnly ? "Read only" : "Could change"} tone={v.readOnly ? "success" : "warning"} />{v.emergency ? <ToneBadge label="Emergency" tone="danger" /> : null}</span></td>
                      <td className="py-2.5 text-right tabular-nums">{v.changes ? <Link href={`/app/audit?support=1&from=${day}&to=${day}`} className="text-[var(--ds-primary-text)] hover:underline">{v.changes}</Link> : <span className="text-[var(--ds-on-surface-muted)]">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </Panel>
      </div>
    </>
  );
}
