import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { TickBar } from "@smw/ui/kit/TickBar";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { Money } from "@smw/ui/finance/Money";
import { Timeline } from "@smw/ui/finance/Timeline";
import { paise } from "@smw/ui/format";
import { OUT_METHODS } from "../constants";
import { LookupService, PettyCashService } from "../service";
import { reversePettyEntry, returnFloat, saveFloat, spendFloat, topUpFloat } from "./actions";
import { JournalLink, NoAccess, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Petty cash" };
const methods = OUT_METHODS.filter((m) => m !== "cheque").map((m) => ({ value: m, label: m.replace(/_/g, " ") }));

export default async function PettyPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "claim")) return <NoAccess ctx={ctx} what="Petty cash" who="staff" />;
  const manage = can(ctx, "manage"), sp = await searchParams, svc = new PettyCashService(ctx), look = new LookupService(ctx);
  const floats = await svc.floats();
  const [accounts, centres, people] = await Promise.all([look.accounts(), look.centres(), manage ? look.people() : []]);
  const pick = floats.find((f) => f.id === one(sp.float)) ?? floats[0];
  const entries = pick ? await svc.entries(pick.id) : [];
  const spendFields = [
    { name: "amountPaise", label: "Amount", type: "money" as const, required: true }, { name: "label", label: "What for", required: true, wide: true },
    { name: "accountId", label: "Spent on", type: "select" as const, required: true, options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    ...(centres.length ? [{ name: "costCentreId", label: "Cost centre", type: "select" as const, options: centres.map((c) => ({ value: c.id, label: c.name })) }] : []),
    { name: "file", label: "Photo of the slip", type: "file" as const, accept: "image/jpeg,image/png,application/pdf", required: true, wide: true, asJpeg: true },
  ];

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Petty cash" description="Small cash kept with a person, spent against a photo of each slip."
        actions={manage ? <FormModal title="New petty cash float" icon="money" fields={[
          { name: "name", label: "Name", required: true, placeholder: "Office, Sports room" }, { name: "holderId", label: "Held by", type: "select", required: true, options: people.map((p) => ({ value: p.id, label: p.name })) },
          { name: "limitPaise", label: "Most it may hold", type: "money", required: true, hint: "Top-ups stop at this amount." },
        ]} action={saveFloat} submitLabel="Open float" trigger={{ label: "New float", plus: true }} /> : null} />
      <SectionNav ctx={ctx} current="/app/expenses/petty" />
      {!floats.length ? (
        <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8"><WidgetEmptyState title="No petty cash float yet" description={manage ? "Open a float for the office or a department. Top it up from the cash box, and the person spends it against slips." : "An accountant opens a float for you. Until then, use a claim to get money back."} />
          {!manage ? <div className="mt-3 text-center"><Link href="/app/expenses/claims" className="underline underline-offset-4">Make a claim instead</Link></div> : null}</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-5">
            {floats.map((f) => (
              <Panel key={f.id} title={<Link href={`/app/expenses/petty?float=${f.id}`} aria-current={f.id === pick?.id ? "true" : undefined} className="underline-offset-4 hover:underline">{f.name}</Link>} action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{f.holderName}</span>}>
                <Money paise={f.balancePaise} size="xl" />
                <div className="mt-3"><TickBar value={f.limitPaise ? (f.balancePaise / f.limitPaise) * 100 : 0} tone={f.balancePaise === 0 ? "warning" : "info"} /><p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{paise(f.balancePaise)} held of {paise(f.limitPaise)} allowed</p></div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <FormModal title={`Spend from ${f.name}`} icon="money" fields={spendFields} hidden={{ floatId: f.id }} action={spendFloat} submitLabel="Record spend" trigger={{ label: "Spend", variant: f.balancePaise ? "default" : "secondary", plus: false }} />
                  {manage ? <FormModal title={`Top up ${f.name}`} icon="money" fields={[{ name: "amountPaise", label: "Amount", type: "money", required: true, hint: `Up to ${paise(f.limitPaise - f.balancePaise)}.` }, { name: "method", label: "From", type: "select", options: methods.filter((m) => m.value === "cash" || m.value === "bank_transfer") }]} values={{ method: "cash" }} hidden={{ floatId: f.id }} action={topUpFloat} submitLabel="Top up" summary={<p className="text-sm text-[var(--ds-on-surface-variant)]">Moves cash from the cash box or bank to the person holding this float.</p>} trigger={{ label: "Top up", variant: "secondary", plus: false }} /> : null}
                  {f.balancePaise > 0 ? <FormModal title={`Return cash from ${f.name}`} icon="money" fields={[{ name: "amountPaise", label: "Amount", type: "money", required: true, hint: `At most ${paise(f.balancePaise)}.` }, { name: "method", label: "Back to", type: "select", options: methods.filter((m) => m.value === "cash" || m.value === "bank_transfer") }]} values={{ method: "cash" }} hidden={{ floatId: f.id }} action={returnFloat} submitLabel="Return cash" trigger={{ label: "Return cash", variant: "ghost", plus: false }} /> : null}
                </div>
              </Panel>
            ))}
          </div>
          <Panel title={pick ? `Entries: ${pick.name}` : "Entries"} className="lg:col-span-7">
            {entries.length ? (
              <>
                <Timeline items={entries.map((e) => ({ at: e.date, title: e.label, meta: [e.kind === "top_up" ? "Top-up" : e.kind === "return" ? "Returned" : e.accountName ?? "Spend", e.status === "reversed" ? "Reversed" : null].filter(Boolean).join(" · "), amountPaise: e.kind === "top_up" ? e.amountPaise : -e.amountPaise, tone: e.status === "reversed" ? "default" : e.kind === "spend" ? "warning" : "success" }))} />
                <ul className="mt-4 divide-y divide-white/[0.06] text-sm">
                  {entries.filter((e) => e.status === "posted").map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 truncate">{e.label}</span>
                      <span className="flex items-center gap-3">{e.fileUrl ? <a href={e.fileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">Slip</a> : null}<JournalLink id={e.journalId} label="Entry" />
                        {manage ? <ActionButton label="Reverse" variant="ghost" action={reversePettyEntry} values={{ id: e.id }} confirm={{ title: "Reverse this entry?", body: "A mirror entry is posted. It is refused when the float would go below zero or above its limit.", confirmLabel: "Reverse", danger: true }} /> : null}</span></li>
                  ))}
                </ul>
              </>
            ) : <WidgetEmptyState title="No entries yet" description={manage ? "Top the float up, then spends appear here with their slip photos." : "Your spends appear here."} />}
          </Panel>
        </div>
      )}
    </>
  );
}
