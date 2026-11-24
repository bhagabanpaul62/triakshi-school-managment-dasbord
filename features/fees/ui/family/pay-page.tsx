import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { qrSvg, upiUri } from "@smw/integrations";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { submitSlip } from "../collect-actions";
import { DeskService } from "../collect/desk-service";
import { BackLink, one, type Search } from "../collect/shared";
import { BillPicker } from "./bill-picker";
import { loadFamily } from "./family-data";
import { OfficeLine } from "./office-line";
import { SlipStates } from "./slip-states";

export const metadata = { title: "Pay fees" };

/** /app/fees/pay: choose bills, scan the school's UPI QR for the exact total, then say you paid. */
export default async function PayPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const [fam, cfg] = await Promise.all([loadFamily(ctx), new DeskService(ctx).config()]);
  const raw = one((await searchParams).bills);
  const all = fam.bills.map((b) => b.id);
  const chosen = raw === "none" ? [] : raw ? raw.split(",").filter((i) => all.includes(i)) : all;
  const picked = fam.bills.filter((b) => chosen.includes(b.id));
  const total = picked.reduce((s, b) => s + b.openPaise + b.latePaise, 0);
  const first = picked[0];
  let uri: string | null = null;
  if (cfg.upiOn && cfg.upi && total > 0 && first) {
    try { uri = upiUri({ upiId: cfg.upi.upiId, name: cfg.upi.name, amountPaise: total, note: `Fees ${first.kid}`.slice(0, 40), ref: `FEE${first.admissionNo}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 30) }); } catch { uri = null; }
  }

  return (
    <>
      <BackLink href="/app/fees">My fees</BackLink>
      <PageHeader eyebrow="My fees" title="Pay fees" description="Choose what to pay, scan the code with any UPI app, then tell the school you paid." />
      {fam.bills.length === 0 ? (
        <div className="flex flex-col gap-4"><EmptyLine title="Nothing to pay right now." hint="You are all paid up. New bills show up here when the school issues them." action={<Link href="/app/fees" className="underline underline-offset-4">Back to my fees</Link>} /><SlipStates kids={fam.kids} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <Panel title="1. Choose what to pay"><BillPicker many={fam.kids.length > 1} chosen={chosen} bills={fam.bills.map((b) => ({ id: b.id, kid: b.kid, label: b.label, dueDate: b.dueDate, state: b.state, latePaise: b.latePaise, totalPaise: b.openPaise + b.latePaise }))} />
              <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Totals include any late fee as of today ({todayIST()}).</p></Panel>
            <SlipStates kids={fam.kids} />
          </div>
          <div className="flex flex-col gap-4">
            {uri ? (
              <Panel title="2. Pay by UPI">
                <p className="mb-3 text-sm">Total <Money paise={total} size="xl" /></p>
                <div className="mx-auto w-56 overflow-hidden rounded-2xl bg-white p-1" dangerouslySetInnerHTML={{ __html: qrSvg(uri) }} />
                <p className="mt-3 text-center text-xs text-[var(--ds-on-surface-muted)]">The amount is already filled in. Pay to <CopyValue value={cfg.upi!.upiId} label="UPI ID" /> ({cfg.upi!.name}). Reference {`FEE${first!.admissionNo}`}.</p>
                <a href={uri} className="mt-3 block rounded-full bg-white/[0.07] py-2 text-center text-sm sm:hidden">Open my UPI app</a>
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <p className="mb-2 text-sm">3. After you pay, tell the school. They check the bank and send your receipt.</p>
                  <FormModal title="I have paid" description="Enter the UTR or transaction ID shown in your UPI app." icon="money" action={submitSlip} submitLabel="Send to the school" trigger={{ label: "I have paid", plus: false }}
                    hidden={{ invoiceIds: chosen.join(",") }} values={{ amountPaise: total, paidOn: todayIST() }} successMessage="Sent. The school will check it and send your receipt."
                    fields={[{ name: "utr", label: "UTR or transaction ID", type: "text", required: true, hint: "12 digits in most UPI apps" }, { name: "paidOn", label: "Date you paid", type: "date", required: true, max: todayIST() }, { name: "amountPaise", label: "Amount you paid", type: "money", required: true },
                      { name: "file", label: "Screenshot (optional)", type: "file", accept: "image/jpeg,image/png,application/pdf", asJpeg: true }]} />
                </div>
              </Panel>
            ) : cfg.upiOn && cfg.upi && !picked.length ? <Panel title="2. Pay by UPI"><p className="text-sm text-[var(--ds-on-surface-muted)]">Tick at least one bill to see the code.</p></Panel> : <OfficeLine school={cfg.school} />}
            {uri ? <OfficeLine school={cfg.school} /> : null}
          </div>
        </div>
      )}
    </>
  );
}
