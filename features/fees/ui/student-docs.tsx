import Link from "next/link";
import type { Ctx } from "@smw/feature-kit";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { defaultConfig, applyHidden, type DocumentKind } from "@smw/feature-finance/templates/config";
import { TemplateService } from "@smw/feature-finance/templates/service";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import { Money } from "@smw/ui/finance/Money";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { fyPeriod, fyStartOf, parsePeriod, periodLabel } from "@smw/ui/finance/logic";
import { CertificateService } from "../service";
import { noDuesData, statementData, tuitionCertificateData } from "../documents";
import { paperConfig } from "./logic";
import { CARD, LINK, MUTED, PILL } from "./styles";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function config(ctx: Ctx, kind: DocumentKind) {
  try { return (await new TemplateService(ctx).current(kind)).config; } catch { return defaultConfig(kind, []); }
}

/** The documents of one student: the statement of account for a period, the tuition fee certificate by financial year, and the no-dues check. Each shows as it prints, with the school's PDF beside it. */
export async function StudentDocs({ ctx, studentId, sp }: { ctx: Ctx; studentId: string; sp: Params }) {
  const today = todayIST(), svc = new CertificateService(ctx);
  const all = one(sp.all) === "1";
  const fy = fyPeriod(fyStartOf(today));
  const period = all ? null : one(sp.period) ? parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) }, today) : fy;
  const certFy = /^\d{4}-\d{2}$/.test(one(sp.fy)) ? one(sp.fy) : fyOf(today);
  const [statement, tuition, noDues, stmtCfg, certCfg] = await Promise.all([
    svc.statement(studentId, period ? { from: period.from, to: period.to } : {}), svc.tuition(studentId, certFy), svc.noDues(studentId), config(ctx, "statement"), config(ctx, "certificate"),
  ]);
  const snap = { studentName: statement.student.name, admissionNo: statement.student.admissionNo, classLabel: statement.student.classLabel, guardian: null };
  const fyOptions = Array.from({ length: 5 }, (_, i) => fyOf(`${fyStartOf(today) - i}-06-01`));
  const qs = period ? `?from=${period.from}&to=${period.to}` : "";
  const s = applyHidden(stmtCfg, statementData({ snapshot: snap, from: period?.from ?? null, to: period?.to ?? null, openingPaise: statement.openingPaise, closingPaise: statement.closingPaise, rows: statement.rows }));
  const t = applyHidden(certCfg, tuitionCertificateData({ snapshot: snap, fy: certFy, totalPaise: tuition.totalPaise, rows: tuition.rows }));
  const n = applyHidden(certCfg, noDuesData({ snapshot: snap, date: noDues.date }));
  const base = `/app/fees/students/${studentId}`;

  return (
    <div className="flex flex-col gap-6">
      <section className={CARD} aria-label="Statement of account">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-medium">Statement of account</h2><p className={MUTED}>{period ? periodLabel(period) : "Every year"}. Closing balance <Money paise={statement.closingPaise} size="sm" />. A positive balance is owed by the student.</p></div>
          <div className="flex gap-2"><a href={`${base}/statement${qs}`} target="_blank" rel="noopener" className={PILL}>Open the PDF</a>{all ? <Link href={`${base}?tab=documents`} className={PILL}>This year only</Link> : <Link href={`${base}?tab=documents&all=1`} className={PILL}>Every year</Link>}</div>
        </div>
        {all ? null : <div className="mb-4"><PeriodPicker today={today} fallback={fy} presets={["this_month", "last_month", "this_fy", "last_fy"]} /></div>}
        <DocumentPaper config={paperConfig(stmtCfg)} data={s} kind="statement" />
      </section>

      <section className={CARD} aria-label="Tuition fee certificate">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-medium">Tuition fee certificate</h2><p className={MUTED}>Tuition fee received in a financial year, for income tax. Only fees marked as tuition count.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-2"><input type="hidden" name="tab" value="documents" /><label className="sr-only" htmlFor="cert-fy">Financial year</label><select id="cert-fy" name="fy" defaultValue={certFy} className="h-10 rounded-full bg-white/[0.06] px-4 text-sm">{fyOptions.map((f) => <option key={f} value={f}>{f}</option>)}</select><button className={PILL} type="submit">Show</button></form>
            {tuition.totalPaise > 0 ? <a href={`${base}/tuition-certificate?fy=${certFy}`} target="_blank" rel="noopener" className={PILL}>Open the PDF</a> : null}
          </div>
        </div>
        {tuition.totalPaise > 0 ? <DocumentPaper config={paperConfig(certCfg)} data={t} kind="certificate" /> : <p className="rounded-2xl bg-white/[0.04] p-4 text-sm">No tuition fee was received in {certFy}, so there is no certificate to print. Pick another year, or <Link href={`/app/fees/collect?student=${studentId}`} className={LINK}>collect a fee</Link>.</p>}
      </section>

      <section className={CARD} aria-label="No dues certificate">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-medium">No dues certificate</h2><p className={MUTED}>Needed for a transfer certificate. It counts the late fee that has built up.</p></div>
          {noDues.clear ? <a href={`${base}/no-dues`} target="_blank" rel="noopener" className={PILL}>Open the PDF</a> : null}
        </div>
        {noDues.clear ? <DocumentPaper config={paperConfig(certCfg)} data={n} kind="certificate" /> : (
          <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
            <p>Not clear yet. <b><Money paise={noDues.owedPaise} /></b> is still owed, so the certificate cannot be given.</p>
            <ul className="divide-y divide-white/[0.06]">{noDues.bills.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/app/fees/invoices/${b.id}`} className={LINK}>{b.number ?? b.label}</Link><Money paise={b.openPaise + b.accruedLatePaise} /></li>)}</ul>
            <p className={MUTED}>Collect the dues, or settle them with a settlement (waive, write off, or split into dates) from the top of this page.</p>
          </div>
        )}
      </section>
    </div>
  );
}
