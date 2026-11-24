// Client-safe: the editor, the HTML preview and the PDF renderer all read these objects.
import { z } from "zod";
import type { DocumentConfig, DocumentData, DocumentField, DocumentKind, DocumentLayout } from "@smw/ui/finance/document-types";

export type { DocumentConfig, DocumentData, DocumentField, DocumentKind, DocumentLayout };

export const KINDS = ["receipt", "invoice", "statement", "certificate", "payslip", "voucher"] as const satisfies readonly DocumentKind[];
export const LAYOUTS = ["a4", "a5", "two_up", "thermal80"] as const satisfies readonly DocumentLayout[];
export const FIELDS = ["logo", "header", "facts", "table", "totals", "words", "notes", "terms", "signature", "qr", "footer", "watermark", "marks"] as const satisfies readonly DocumentField[];

export const KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt", invoice: "Invoice", statement: "Statement", certificate: "Certificate", payslip: "Payslip", voucher: "Voucher",
};
export const LAYOUT_LABEL: Record<DocumentLayout, string> = { a4: "A4", a5: "A5", two_up: "Two on A4 (school and family copy)", thermal80: "80 mm roll" };
export const FIELD_LABEL: Record<DocumentField, string> = {
  logo: "Logo", header: "School name and address", facts: "Details", table: "Lines", totals: "Totals", words: "Amount in words", notes: "Notes",
  terms: "Terms", signature: "Signature", qr: "QR check code", footer: "Footer", watermark: "Watermark", marks: "Stamps (Duplicate, Reversed)",
};
export const DEFAULT_COPIES = ["School copy", "Family copy"];

/** Details and totals a school may hide by label. The code that builds a document's data uses these exact labels. */
export const TOGGLEABLE: Record<DocumentKind, { facts: string[]; totals: string[] }> = {
  receipt: { facts: ["Guardian", "Class", "Payment reference"], totals: ["Balance after payment"] },
  invoice: { facts: ["Guardian", "Class"], totals: [] },
  statement: { facts: ["Guardian", "Class"], totals: [] },
  certificate: { facts: ["Guardian", "Class"], totals: [] },
  payslip: { facts: ["PAN", "Bank account"], totals: [] },
  voucher: { facts: ["Reference"], totals: [] },
};

/** Where uploaded images live: `/api/files/<schoolId>/...`. */
export const FILE_ROUTE = "/api/files/";

const text = (max: number) => z.string().trim().max(max);
const column = z.object({ key: z.string().trim().min(1).max(30), label: text(40), align: z.enum(["left", "right", "center"]), show: z.boolean() });
const image = z.string().max(300).startsWith(FILE_ROUTE).nullish();

export const documentConfig = z.object({
  layout: z.enum(LAYOUTS),
  accent: z.enum(["theme", "none"]),
  title: text(60).min(1, "Give the document a title."),
  headerLines: z.array(text(120)).max(8),
  /** A logo for this document only; empty means the school's own logo. */
  logoUrl: image,
  columns: z.array(column).max(10),
  terms: text(1000).nullish(),
  footer: text(200).nullish(),
  signature: z.object({ name: text(60), title: text(60), imageUrl: image }).nullish(),
  watermark: text(30).nullish(),
  copies: z.array(text(30)).max(2).optional(),
  showFields: z.partialRecord(z.enum(FIELDS), z.boolean()).optional(),
  hiddenFacts: z.array(text(40)).max(20).default([]),
  hiddenTotals: z.array(text(40)).max(20).default([]),
});
/** The shared config plus the two lists of hidden labels, applied to the data by `applyHidden`. */
export type TemplateConfig = DocumentConfig & { hiddenFacts: string[]; hiddenTotals: string[] };

/** Read stored or submitted JSON. Throws a ZodError on anything that is not a config. */
export function parseConfig(input: unknown): TemplateConfig { return documentConfig.parse(input) as TemplateConfig; }

const col = (key: string, label: string, align: "left" | "right" | "center" = "right", show = true) => ({ key, label, align, show });

const COLUMNS: Record<DocumentKind, TemplateConfig["columns"]> = {
  receipt: [col("item", "Description", "left"), col("fee", "Fee"), col("concession", "Concession", "right", false), col("late", "Late fee", "right", false), col("amount", "Amount")],
  invoice: [col("item", "Description", "left"), col("fee", "Amount"), col("concession", "Concession"), col("late", "Late fee", "right", false), col("amount", "Payable")],
  statement: [col("date", "Date", "left"), col("ref", "Reference", "left"), col("item", "Particulars", "left"), col("debit", "Debit"), col("credit", "Credit"), col("balance", "Balance")],
  certificate: [col("item", "Description", "left")],
  payslip: [col("item", "Component", "left"), col("earn", "Earnings"), col("deduct", "Deductions")],
  voucher: [col("item", "Particulars", "left"), col("debit", "Debit"), col("credit", "Credit")],
};
const TITLE: Record<DocumentKind, string> = { receipt: "Fee receipt", invoice: "Invoice", statement: "Statement of account", certificate: "Certificate", payslip: "Payslip", voucher: "Payment voucher" };

/** What a school gets before it changes anything. `headerLines` are filled from the school's profile by the service. */
export function defaultConfig(kind: DocumentKind, headerLines: string[] = []): TemplateConfig {
  const signs = kind === "receipt" || kind === "invoice" || kind === "voucher" || kind === "certificate";
  return {
    layout: kind === "receipt" ? "a5" : "a4",
    accent: "theme",
    title: TITLE[kind],
    headerLines,
    logoUrl: null,
    columns: COLUMNS[kind],
    terms: kind === "invoice" ? "Please pay by the due date. A late fee may apply after it." : null,
    footer: "This is a computer generated document.",
    signature: signs ? { name: "Authorised signatory", title: "", imageUrl: null } : null,
    watermark: null,
    copies: [],
    showFields: kind === "certificate" ? { table: false, qr: true } : {},
    hiddenFacts: [],
    hiddenTotals: [],
  };
}

/** Which copy labels a layout prints: two_up prints both, the others the first. */
export function copyLabels(c: Pick<DocumentConfig, "layout" | "copies">): (string | undefined)[] {
  const labels = c.copies?.length ? c.copies : c.layout === "two_up" ? DEFAULT_COPIES : [];
  return c.layout === "two_up" ? [labels[0] ?? DEFAULT_COPIES[0], labels[1] ?? DEFAULT_COPIES[1]] : [labels[0]];
}

/** The data with the details and totals the school chose to hide taken out. Run before both the preview and the PDF. */
export function applyHidden(c: Pick<TemplateConfig, "hiddenFacts" | "hiddenTotals">, d: DocumentData): DocumentData {
  const f = new Set(c.hiddenFacts), t = new Set(c.hiddenTotals);
  return { ...d, facts: d.facts.filter(([k]) => !f.has(k)), totals: d.totals.filter(([k]) => !t.has(k)) };
}

/** A made-up document for the editor preview and the sample PDF. */
export function sampleData(kind: DocumentKind): DocumentData {
  const base: DocumentData = {
    facts: [["Number", "RCP/2026-27/000123"], ["Date", "24 Nov 2026"], ["Student", "Priya Sharma"], ["Admission no", "A-1042"], ["Class", "7 - B"], ["Guardian", "Rakesh Sharma"], ["Payment reference", "UPI 4021 7788 91"]],
    rows: [
      { item: "Tuition fee, term 2", fee: "₹12,000.00", concession: "₹1,200.00", late: "₹0.00", amount: "₹10,800.00" },
      { item: "Transport, Nov to Jan", fee: "₹3,600.00", concession: "₹0.00", late: "₹150.00", amount: "₹3,750.00" },
    ],
    totals: [["Total", "₹14,550.00"], ["Received", "₹14,550.00", true], ["Balance after payment", "₹0.00"]],
    amountWords: "Rupees fourteen thousand five hundred fifty only",
    notes: [], marks: [], qrSvg: null,
  };
  if (kind === "statement") return { ...base, facts: base.facts.slice(0, 5), rows: [{ date: "01 Apr", ref: "INV/2026-27/000014", item: "Tuition fee, term 1", debit: "₹12,000.00", credit: "", balance: "₹12,000.00" }, { date: "10 Apr", ref: "RCP/2026-27/000031", item: "Paid by UPI", debit: "", credit: "₹12,000.00", balance: "₹0.00" }], totals: [["Closing balance", "₹0.00", true]], amountWords: null };
  if (kind === "certificate") return { ...base, rows: [{ item: "This is to certify that Priya Sharma, Class 7 - B, has paid all fees due up to 24 Nov 2026." }], totals: [], amountWords: null };
  if (kind === "payslip") return { ...base, facts: [["Employee", "Anita Rao"], ["Month", "November 2026"], ["PAN", "ABCDE1234F"], ["Bank account", "XXXX 4421"]], rows: [{ item: "Basic", earn: "₹32,000.00", deduct: "" }, { item: "Provident fund", earn: "", deduct: "₹3,840.00" }], totals: [["Net pay", "₹28,160.00", true]], amountWords: "Rupees twenty-eight thousand one hundred sixty only" };
  if (kind === "voucher") return { ...base, facts: [["Voucher no", "PV/2026-27/000009"], ["Date", "24 Nov 2026"], ["Paid to", "Sai Stationers"], ["Reference", "Bill 5521"]], rows: [{ item: "Stationery for office", debit: "₹4,200.00", credit: "" }, { item: "Cash", debit: "", credit: "₹4,200.00" }], totals: [["Amount", "₹4,200.00", true]], amountWords: "Rupees four thousand two hundred only" };
  if (kind === "invoice") return { ...base, facts: [["Number", "INV/2026-27/000014"], ...base.facts.slice(1, 6), ["Due date", "10 Dec 2026"]], totals: [["Total", "₹14,550.00", true]] };
  return base;
}
