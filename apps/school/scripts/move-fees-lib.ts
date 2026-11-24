// Runs the fee move for every school, one transaction each, and prints a plain-text report per school.
import { schools, withConsole, withSchool } from "@smw/db";
import { rupees } from "@smw/feature-kit/money";
import { FeeMover, type MoveReport } from "@smw/feature-fees/move/mover";

class DryRun extends Error { constructor(readonly report: MoveReport) { super("dry run"); } }
const KEYS = ["gross", "concession", "late", "paid", "due"] as const;

export function formatReport(name: string, r: MoveReport, dryRun: boolean): string {
  const out = [`== ${name}: ${r.status}${dryRun && r.status === "moved" ? " (dry run, rolled back)" : ""}`];
  if (r.status !== "moved") return out.join("\n");
  const row = (label: string, n: Record<(typeof KEYS)[number], number>) => `  ${label.padEnd(26)}${KEYS.map((k) => rupees(n[k]).padStart(16)).join("")}`;
  out.push(`  counts: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  out.push(`  ${"as of ".concat(r.today).padEnd(26)}${KEYS.map((k) => k.padStart(16)).join("")}`);
  out.push(row("old calculator", r.totals.old), row("not billed (left)", r.totals.notBilled), row("new tables", r.totals.new));
  out.push(`  overpaid, held as advance: ${rupees(r.totals.creditToAdvance)}; receipts old ${rupees(r.receipts.oldValidPaise)} = new ${rupees(r.receipts.newValidPaise)}; reversed ${r.receipts.reversed}; advances ${rupees(r.receipts.advancePaise)}`);
  const list = (title: string, rows: string[]) => { if (rows.length) out.push(`  ${title} (${rows.length})`, ...rows.map((x) => `    ${x}`)); };
  list("D1 money on another class's fee, held as advance; confirm with the school", r.orphans.map((o) => `${o.student}, ${o.receiptNo} of ${o.paidOn}: ${rupees(o.paise)} advance; old screens showed due ${o.oldAppDuePaise === null ? "-" : rupees(o.oldAppDuePaise)}, new due ${rupees(o.newDuePaise)}`));
  list("D4 left students, instalments after leaving not billed", r.notBilled.map((n) => `${n.student}: ${n.instalments} instalment(s); old due ${rupees(n.oldDuePaise)}, new due ${rupees(n.newDuePaise)}`));
  list("D3 dues of past years, now shown", r.pastYearDues.map((p) => `${p.year}: ${p.students} student(s), ${rupees(p.duePaise)}`));
  list("Paid above a reduced bill, held as advance", r.credits.map((c) => `${c.student}, ${c.receiptNo}: ${rupees(c.paise)}`));
  return out.join("\n");
}

/** Move every school. A school that fails writes nothing and is named at the end; the others still move. */
export async function moveFees(o: { dryRun?: boolean } = {}): Promise<void> {
  const list = await withConsole((tx) => tx.select({ id: schools.id, slug: schools.slug }).from(schools).orderBy(schools.slug));
  const failed: string[] = [];
  for (const s of list) {
    try {
      let report: MoveReport;
      try {
        report = await withSchool(s.id, async (tx) => {
          const r = await FeeMover.for(s.id).run(tx);
          if (o.dryRun) throw new DryRun(r);
          return r;
        });
      } catch (e) {
        if (!(e instanceof DryRun)) throw e;
        report = e.report;
      }
      console.log(formatReport(s.slug, report, !!o.dryRun));
    } catch (e) {
      failed.push(s.slug);
      console.error(`== ${s.slug}: FAILED, nothing was written for this school\n${e instanceof Error ? e.message : e}`);
    }
  }
  if (failed.length) throw new Error(`The fee move failed for: ${failed.join(", ")}`);
}
