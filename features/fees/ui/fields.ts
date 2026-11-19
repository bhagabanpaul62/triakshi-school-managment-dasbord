import type { Field } from "@smw/ui/shell/FormModal";
import type { Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { formatMoneyCompact } from "@smw/ui/money";
import { paise } from "@smw/ui/format";
import { rupees, type LineStatus } from "../calculator";

type Option = { value: string; label: string };
const opts = (rows: { id: string; name: string }[]): Option[] => rows.map((r) => ({ value: r.id, label: r.name }));

export const METHOD_OPTIONS: Option[] = [
  { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank transfer" },
];

export const headFields: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "Tuition", wide: true },
  { name: "kind", label: "Type", type: "select", required: true, options: [
    { value: "tuition", label: "Tuition" }, { value: "admission", label: "Admission" }, { value: "transport", label: "Transport" },
    { value: "exam", label: "Exam" }, { value: "other", label: "Other" },
  ] },
  { name: "isRecurring", label: "Repeats", type: "checkbox", placeholder: "Charged every year" },
];

export const concessionFields = (heads: { id: string; name: string }[]): Field[] => [
  { name: "headId", label: "Applies to", type: "select", options: opts(heads), hint: "Leave empty for the whole fee" },
  { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }] },
  { name: "percent", label: "Percent off", type: "number", step: "0.01", min: 0, max: 100, hint: "Use when the type is Percent" },
  { name: "amountPaise", label: "Amount off", type: "money", hint: "Use when the type is Amount" },
  { name: "reason", label: "Reason", required: true, wide: true, placeholder: "Sibling discount" },
];

export const copyFields = (classes: { id: string; name: string }[]): Field[] => [
  { name: "classId", label: "Copy to class", type: "select", required: true, options: opts(classes), wide: true },
];

export const cancelFields: Field[] = [{ name: "reason", label: "Why is it cancelled?", type: "textarea", required: true }];

/** Status → badge. One mapping for the dashboard and the ledger so a status always looks the same. */
export const STATUS_BADGE: Record<LineStatus | "due", { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "success" },
  partial: { label: "Part paid", tone: "warning" },
  pending: { label: "Upcoming", tone: "default" },
  overdue: { label: "Overdue", tone: "danger" },
  due: { label: "Due", tone: "warning" },
};
export const STATUS_TONES: Record<string, Tone> = { overdue: "danger", due: "warning", paid: "success" };
export const STATUS_LABELS: Record<string, string> = { overdue: "Overdue", due: "Due", paid: "Paid up" };

/** "₹50 a day after 5 days, up to ₹500" */
export function describeRule(r: { kind: "flat" | "per_day"; amountPaise: number; graceDays: number; maxPaise: number | null }) {
  const grace = r.graceDays ? ` after ${r.graceDays} day${r.graceDays === 1 ? "" : "s"}` : " after the due date";
  const cap = r.maxPaise ? `, up to ${rupees(r.maxPaise)}` : "";
  return r.kind === "flat" ? `${rupees(r.amountPaise)} once${grace}${cap}` : `${rupees(r.amountPaise)} a day${grace}${cap}`;
}

/** Compact money from paise for tiles and chart labels: 123456700 -> "₹12.3L". Full figures use `paise()`. */
export const compact = (p: number) => formatMoneyCompact(p / 100);

/** Whole rupees for lists where paise only add noise ("₹31,667", not "₹31,666.67"). */
export const whole = (p: number) => paise(Math.round(p / 100) * 100);

/** Money for a tile: full below a lakh ("₹86,500"), compact above ("₹1.2L"). */
export const tile = (p: number) => (p >= 10_000_000 ? compact(p) : whole(p));
