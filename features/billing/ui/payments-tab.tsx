import type { BillingService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { paise } from "@smw/ui/format";
import { uploadTdsCertificate } from "./actions";

const columns: Column[] = [
  { key: "paidAt", label: "Paid on", type: "date" },
  { key: "invoiceNumber", label: "Invoice", type: "mono" },
  { key: "amountPaise", label: "Paid", type: "money" },
  { key: "tdsPaise", label: "Tax withheld", type: "money", hideOnMobile: true },
  { key: "method", label: "Method", type: "badge", labels: { cashfree: "Online", bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", upi: "UPI" }, hideOnMobile: true },
  { key: "reference", label: "Reference", type: "mono", hideOnMobile: true },
  { key: "certState", label: "TDS certificate", type: "badge", labels: { awaited: "Awaited", received: "Sent", verified: "Verified" }, tones: { awaited: "warning", received: "info", verified: "success" } },
];
const fields: Field[] = [{ name: "file", label: "Certificate (Form 16A)", type: "file", accept: "application/pdf,image/png,image/jpeg", required: true, hint: "A PDF or a clear photo, up to 15 MB." }];
const LINK = "inline-flex h-10 items-center rounded-full px-4 text-sm text-[var(--ds-color-primary-400)] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export async function PaymentsTab({ svc, params, canManage }: { svc: BillingService; params: Record<string, string | string[] | undefined>; canManage: boolean }) {
  const [page, certs] = await Promise.all([svc.listPayments(listQueryFrom(params)), svc.tdsCertificates()]);
  const awaited = certs.filter((c) => c.status === "awaited");
  const rows = page.rows.map((r) => ({ ...r, tdsPaise: r.tdsPaise || null, certState: r.certificate?.status ?? null }));
  return (
    <div className="flex flex-col gap-6">
      {awaited.length ? (
        <Panel title="TDS certificates to upload" action={<ToneBadge label={`${awaited.length} awaited`} tone="warning" />}>
          <p className="mb-4 max-w-[60ch] text-sm text-[var(--ds-on-surface-variant)]">You withheld tax when you paid us. Upload the certificate you get from the tax portal so we can match it to our records.</p>
          <ul className="flex flex-col gap-2">
            {awaited.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.035] p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><span className="font-mono text-xs">{c.invoiceNumber}</span> · {c.quarter} · {paise(c.amountPaise)} withheld</p>
                  {c.note ? <p className="mt-1 text-xs text-[var(--ds-color-warning-300)]">Sent back: {c.note}</p> : null}
                </div>
                {canManage
                  ? <FormModal title="Upload TDS certificate" description={`${c.quarter}, ${paise(c.amountPaise)} withheld on ${c.invoiceNumber}.`} icon="billing" fields={fields} hidden={{ certId: c.id }}
                      action={uploadTdsCertificate} submitLabel="Send certificate" trigger={{ label: "Upload certificate", size: "sm", plus: false }} />
                  : <span className="text-xs text-[var(--ds-on-surface-muted)]">Ask your school administrator to upload it.</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchable={false}
        empty={{ title: "No payments yet.", description: "Payments you make to Triakshi appear here, with their receipts." }}
        rowActions={Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            {r.certificate && r.certificate.status !== "awaited" ? <a href={`/app/billing/tds/${r.certificate.id}`} className={LINK}>View certificate</a> : null}
            {r.invoiceId ? <a href={`/app/billing/invoices/${r.invoiceId}/pdf`} className={LINK} aria-label={`Download receipt for ${r.invoiceNumber}`}>Receipt</a> : null}
          </span>
        )]))} />
    </div>
  );
}
