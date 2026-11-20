import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { BigStat } from "@smw/ui/kit/BigStat";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { LABEL, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { initials, paise, shortDate } from "@smw/ui/format";
import { DuesService, FeeHeadService, METHOD_LABEL } from "../service";
import { RecordPaymentModal } from "./record-payment";
import { addConcession, cancelPayment, deleteConcession, recordPayment } from "./actions";
import { STATUS_BADGE, cancelFields, concessionFields, tile, whole } from "./fields";

export const metadata = { title: "Fee ledger" };

export default async function StudentLedgerPage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { studentId } = await params;
  const pay = (await searchParams).pay === "1";
  const ctx = await requireCtx();
  const dues = new DuesService(ctx);
  const ledger = await dues.studentLedger(studentId).catch((e) => { if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound(); throw e; });
  const { student, statement, structure, payments, concessions } = ledger;
  const hasBook = !!structure || statement.lines.length > 0;
  const t = statement.totals;
  const staff = dues.can("manage");
  const heads = staff ? await new FeeHeadService(ctx).options() : [];
  const standing = t.due === 0 ? "paid" : t.overdue > 0 ? "overdue" : "pending";
  const next = statement.lines.find((x) => x.due > 0);
  const paidPct = t.net + t.late > 0 ? Math.min(100, Math.round((t.paid / (t.net + t.late)) * 100)) : 0;
  const badge = standing === "paid" ? { label: "Paid up", tone: "success" as const } : standing === "overdue" ? STATUS_BADGE.overdue : STATUS_BADGE.due;

  return (
    <>
      <EntityHeader
        back={dues.can("read") ? { href: "/app/fees", label: "All dues" } : undefined}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.07] text-lg" aria-hidden>{initials(student.name)}</span>}
        title={student.name}
        chips={hasBook ? <ToneBadge label={badge.label} tone={badge.tone} /> : undefined}
        meta={[[student.className, student.sectionName].filter(Boolean).join("-"), `Admission no. ${student.admissionNo}`, ledger.year.name]}
        actions={staff && hasBook ? (
          <>
            <FormModal title="Add concession" icon="receipt" fields={concessionFields(heads)} hidden={{ studentId }} values={{ kind: "percent" }} action={addConcession} submitLabel="Add" trigger={{ label: "Add concession", variant: "secondary" }} />
            <RecordPaymentModal studentId={studentId} studentName={student.name} calc={ledger.input} today={ledger.today} action={recordPayment} autoOpen={pay} />
          </>
        ) : undefined}
      />
      <div className="h-8" />
      {!hasBook ? (
        <Panel><WidgetEmptyState title="No fees set for this class." description={staff ? "Set up the class's fee structure to start billing." : "The school has not set fees for this class yet."} /></Panel>
      ) : (
        <>
          <KpiRow>
            <StatCard label="Total fee" value={tile(t.net + t.late)} icon={<MenuIconView name="receipt" />} meta={t.concession ? `${paise(t.concession)} concession` : `${paise(t.gross)} for the year`} />
            <StatCard label="Paid" value={tile(t.paid)} icon={<MenuIconView name="check" />} meta={`${payments.filter((p) => p.status === "valid").length} receipts`} />
            <StatCard label="Due" value={tile(t.due)} icon={<MenuIconView name="money" />} meta={t.overdue ? `${paise(t.overdue)} overdue` : t.due ? "Nothing overdue" : "All clear"} />
            <StatCard label="Late fee" value={tile(t.late)} icon={<MenuIconView name="clock" />} meta={t.late ? "Included in the total" : "None so far"} />
          </KpiRow>

          <PanelGrid>
            <div className="lg:col-span-12">
              <Panel title={t.due ? "What to pay next" : "All paid"}>
                {next ? (
                  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                    <BigStat label={`${next.name} · due ${shortDate(next.dueDate)}`} value={whole(next.due)} tone={next.status === "overdue" ? "danger" : "default"}
                      hint={next.status === "overdue" ? `Overdue${next.lateFee ? `, includes ${paise(next.lateFee)} late fee` : ""}` : t.due > next.due ? `${paise(t.due)} due across all installments` : "Nothing else is due"} />
                    <p className="max-w-sm text-sm text-[var(--ds-on-surface-muted)]">
                      {staff ? "Use Record payment above. The receipt is numbered and ready to print right away." : "Pay at the school fee counter by cash, cheque or UPI. Your receipt appears here the same day."}
                    </p>
                  </div>
                ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Every installment is paid. Receipts are below.</p>}
              </Panel>
            </div>
            <div className="lg:col-span-8">
              <Panel title="Installments" className="h-full">
                <div className="custom-scrollbar -mx-2 overflow-x-auto">
                  <table className="w-full sm:min-w-[560px] text-sm">
                    <thead>
                      <tr className={LABEL}>
                        <th scope="col" className="px-2 pb-3 text-left font-normal">Installment</th>
                        <th scope="col" className="hidden px-2 pb-3 text-right font-normal sm:table-cell">Fee</th>
                        <th scope="col" className="hidden px-2 pb-3 text-right font-normal sm:table-cell">Late fee</th>
                        <th scope="col" className="px-2 pb-3 text-right font-normal">Paid</th>
                        <th scope="col" className="px-2 pb-3 text-right font-normal">Due</th>
                        <th scope="col" className="px-2 pb-3 text-right font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.lines.map((l) => (
                        <tr key={l.installmentId} className="transition-colors hover:bg-white/[0.04]">
                          <td className="rounded-l-xl px-2 py-3">{l.name}<span className="block text-xs text-[var(--ds-on-surface-muted)]">Due {shortDate(l.dueDate)}<span className="sm:hidden"> · Fee {paise(l.net)}</span></span></td>
                          <td className="hidden px-2 py-3 text-right tabular-nums sm:table-cell">{paise(l.net)}{l.concession ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">after {paise(l.concession)} off</span> : null}</td>
                          <td className="hidden px-2 py-3 text-right tabular-nums sm:table-cell">{l.lateFee ? paise(l.lateFee) : "-"}</td>
                          <td className="px-2 py-3 text-right tabular-nums">{paise(l.paid)}</td>
                          <td className="px-2 py-3 text-right tabular-nums">{paise(l.due)}</td>
                          <td className="rounded-r-xl px-2 py-3 text-right"><ToneBadge label={STATUS_BADGE[l.status].label} tone={STATUS_BADGE[l.status].tone} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            <div className="lg:col-span-4">
              <Panel title="Details" className="h-full">
                <SegmentedGauge value={paidPct} tone={paidPct === 100 ? "success" : "info"} label="paid" caption={`${paise(t.paid)} of ${paise(t.net + t.late)}`} />
                <FactList>
                  <Fact label="Fee structure">{structure?.name}</Fact>
                  <Fact label="Year">{ledger.year.name}</Fact>
                  <Fact label="Concession">{t.concession ? `-${paise(t.concession)}` : null}</Fact>
                  <Fact label="Credit">{t.credit ? paise(t.credit) : null}</Fact>
                </FactList>
              </Panel>
            </div>

            {concessions.length || staff ? (
              <div className="lg:col-span-4">
                <Panel title="Concessions">
                  {concessions.length === 0 ? <WidgetEmptyState title="No concessions." description="Add one for siblings, staff children or hardship." /> : (
                    <ul className="flex flex-col">
                      {concessions.map((c) => (
                        <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{c.reason}</span>
                            <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{c.headName ?? "Whole fee"}</span>
                          </span>
                          <span className="text-sm tabular-nums">{c.kind === "percent" ? `${c.value / 100}%` : paise(c.value)}</span>
                          {staff ? <ActionButton variant="icon-delete" label={`Remove concession ${c.reason}`} action={deleteConcession} values={{ id: c.id }}
                            confirm={{ title: "Remove this concession?", body: `${student.name}'s dues go back up by the amount it took off.`, confirmLabel: "Remove", danger: true }} /> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            ) : null}

            <div className={concessions.length || staff ? "lg:col-span-8" : "lg:col-span-12"}>
              <Panel title="Payments">
                {payments.length === 0 ? <WidgetEmptyState title="No payments yet." description="Receipts appear here once a payment is recorded." /> : (
                  <ul className="flex flex-col">
                    {payments.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-2 py-3 hover:bg-white/[0.03]">
                        <span className="min-w-0 flex-1">
                          <span className="block break-all font-mono text-xs">{p.receiptNo}</span>
                          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">
                            {shortDate(p.paidOn)} · {METHOD_LABEL[p.method]}{p.reference ? ` ${p.reference}` : ""} · {p.allocations.map((a) => a.name).join(", ")}
                            {p.status === "cancelled" && p.cancelReason ? ` · ${p.cancelReason}` : ""}
                          </span>
                        </span>
                        {p.status === "cancelled" ? <ToneBadge label="Cancelled" tone="danger" /> : null}
                        <span className={p.status === "cancelled" ? "text-sm tabular-nums line-through opacity-60" : "text-sm tabular-nums"}>{paise(p.amountPaise)}</span>
                        <a href={`/app/fees/receipts/${p.id}`} target="_blank" rel="noopener" aria-label={`Open receipt ${p.receiptNo} as PDF`} title="Open receipt PDF"
                          className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-3 text-xs hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Receipt</a>
                        {staff && p.status === "valid" ? (
                          <FormModal title="Cancel payment" description={`${p.receiptNo} · ${paise(p.amountPaise)}. The amount goes back on the dues; the receipt number stays on file.`} icon="receipt"
                            fields={cancelFields} hidden={{ id: p.id }} action={cancelPayment} submitLabel="Cancel payment" trigger={{ label: "Cancel", variant: "ghost", size: "sm" }} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </PanelGrid>
        </>
      )}
    </>
  );
}
