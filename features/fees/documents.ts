// What each fee document says, as the data the finance template renderer prints (receipt, invoice, statement, certificates, refund voucher).
// Pure: no database. The labels of toggleable details are the ones in TOGGLEABLE, so a school can hide them by name.
import { inWords, rupees } from "@smw/feature-kit/money";
import { qrSvg } from "@smw/integrations";
import type { DocumentData } from "@smw/feature-finance/templates/config";
import { METHOD_LABEL, type PayMethod } from "./constants";
import type { Snapshot } from "./base";

export const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const money = (p: number) => (p ? rupees(p) : "");

/** Who it is for: Student and Admission no always, Class and Guardian when known (a school may hide those two). */
const who = (s: Snapshot): [string, string][] => [["Student", s.studentName], ["Admission no", s.admissionNo], ["Class", s.classLabel], ...(s.guardian ? [["Guardian", s.guardian] as [string, string]] : [])];

export interface ReceiptDoc {
  number: string; date: string; amountPaise: number; advancePaise: number; status: string; payerName: string | null; note: string | null; snapshot: Snapshot; verifyUrl: string;
  methods: { method: PayMethod; amountPaise: number; reference: string | null }[];
  /** One row per bill the money went to. */
  rows: { bill: string; feePaise: number; latePaise: number }[];
  /** What the student's bills stood at just after this receipt; null when the ledger has nothing (cash basis). */
  balanceAfterPaise: number | null;
}
const RECEIPT_MARKS: Record<string, string> = { reversed: "REVERSED", bounced: "CHEQUE BOUNCED", clearing: "CHEQUE NOT CLEARED YET" };

export function receiptData(r: ReceiptDoc): DocumentData {
  const refs = r.methods.filter((m) => m.reference).map((m) => `${METHOD_LABEL[m.method]} ${m.reference}`).join(", ");
  return {
    facts: [["Receipt no", r.number], ["Date", day(r.date)], ...who(r.snapshot), ...(r.payerName ? [["Received from", r.payerName] as [string, string]] : []), ...(refs ? [["Payment reference", refs] as [string, string]] : [])],
    rows: [
      ...r.rows.map((x) => ({ item: x.bill, fee: rupees(x.feePaise), concession: "", late: money(x.latePaise), amount: rupees(x.feePaise + x.latePaise) })),
      ...(r.advancePaise ? [{ item: "Kept as advance for the next bill", fee: "", concession: "", late: "", amount: rupees(r.advancePaise) }] : []),
    ],
    totals: [...r.methods.map((m): [string, string] => [`Paid by ${METHOD_LABEL[m.method]}`, rupees(m.amountPaise)]), ["Received", rupees(r.amountPaise), true], ...(r.balanceAfterPaise === null ? [] : [["Balance after payment", rupees(r.balanceAfterPaise)] as [string, string]])],
    amountWords: inWords(r.amountPaise),
    notes: r.note ? [r.note] : [],
    marks: RECEIPT_MARKS[r.status] ? [RECEIPT_MARKS[r.status]!] : [],
    qrSvg: qrSvg(r.verifyUrl),
  };
}

export interface InvoiceDoc {
  number: string; label: string; issueDate: string; dueDate: string; status: string; note: string | null; snapshot: Snapshot; verifyUrl: string;
  lines: { kind: string; label: string; amountPaise: number; concessionPaise: number; creditedPaise: number }[];
  paidPaise: number;
}

export function invoiceData(i: InvoiceDoc): DocumentData {
  const payable = (l: InvoiceDoc["lines"][number]) => l.amountPaise - l.concessionPaise - l.creditedPaise;
  const total = i.lines.reduce((s, l) => s + payable(l), 0);
  const open = Math.max(0, total - i.paidPaise);
  return {
    facts: [["Invoice no", i.number], ["Date", day(i.issueDate)], ...who(i.snapshot), ["Due date", day(i.dueDate)]],
    rows: i.lines.map((l) => ({ item: l.label, fee: l.kind === "late" ? "" : rupees(l.amountPaise), concession: money(l.concessionPaise + l.creditedPaise), late: l.kind === "late" ? rupees(l.amountPaise) : "", amount: rupees(payable(l)) })),
    totals: [["Total", rupees(total)], ...(i.paidPaise ? [["Paid", rupees(i.paidPaise)] as [string, string]] : []), ["Balance due", rupees(open), true]],
    amountWords: inWords(total),
    notes: [i.label, ...(i.note ? [i.note] : [])],
    marks: i.status === "cancelled" ? ["CANCELLED"] : i.status === "issued" && open === 0 ? ["PAID"] : [],
    qrSvg: qrSvg(i.verifyUrl),
  };
}

export function statementData(s: { snapshot: Snapshot; from: string | null; to: string | null; openingPaise: number; closingPaise: number; rows: { date: string; number: string; memo: string; debitPaise: number; creditPaise: number; balancePaise: number }[] }): DocumentData {
  return {
    facts: [...who(s.snapshot), ["Period", s.from || s.to ? `${s.from ? day(s.from) : "Start"} to ${s.to ? day(s.to) : "today"}` : "All years"]],
    rows: [
      ...(s.from ? [{ date: "", ref: "", item: "Opening balance", debit: "", credit: "", balance: rupees(s.openingPaise) }] : []),
      ...s.rows.map((r) => ({ date: day(r.date), ref: r.number, item: r.memo, debit: money(r.debitPaise), credit: money(r.creditPaise), balance: rupees(r.balancePaise) })),
    ],
    totals: [["Closing balance", rupees(s.closingPaise), true]],
    amountWords: null, notes: ["A positive balance is owed by the student; a negative one is in the student's favour."], marks: [], qrSvg: null,
  };
}

export function tuitionCertificateData(c: { snapshot: Snapshot; fy: string; totalPaise: number; rows: { number: string; date: string; head: string; amountPaise: number }[] }): DocumentData {
  const s = c.snapshot;
  return {
    facts: [...who(s), ["Financial year", c.fy]],
    rows: [
      { item: `This is to certify that ${s.studentName} (admission no ${s.admissionNo}, ${s.classLabel}) has paid ${rupees(c.totalPaise)} (${inWords(c.totalPaise)}) as tuition fee in the financial year ${c.fy}.` },
      ...c.rows.map((r) => ({ item: `${day(r.date)}: ${r.head}, receipt ${r.number}, ${rupees(r.amountPaise)}` })),
    ],
    totals: [], amountWords: null, notes: [], marks: [], qrSvg: null,
  };
}

export function noDuesData(c: { snapshot: Snapshot; date: string }): DocumentData {
  const s = c.snapshot;
  return {
    facts: who(s),
    rows: [{ item: `This is to certify that ${s.studentName} (admission no ${s.admissionNo}, ${s.classLabel}) has no fees due to the school as on ${day(c.date)}.` }],
    totals: [], amountWords: null, notes: [], marks: [], qrSvg: null,
  };
}

export function refundVoucherData(v: { number: string; date: string; snapshot: Snapshot; source: string; method: string; reference: string | null; reason: string; amountPaise: number; verifyUrl?: string }): DocumentData {
  return {
    facts: [["Voucher no", v.number], ["Date", day(v.date)], ["Paid to", v.snapshot.guardian ?? v.snapshot.studentName], ["Student", `${v.snapshot.studentName} (${v.snapshot.admissionNo})`], ...(v.reference ? [["Reference", v.reference] as [string, string]] : [])],
    rows: [{ item: `Refund of the ${v.source} held for ${v.snapshot.studentName}`, debit: rupees(v.amountPaise), credit: "" }, { item: v.method === "cash" ? "Cash" : `Bank (${v.method.replace("_", " ")})`, debit: "", credit: rupees(v.amountPaise) }],
    totals: [["Amount", rupees(v.amountPaise), true]],
    amountWords: inWords(v.amountPaise), notes: [v.reason], marks: [], qrSvg: null,
  };
}
