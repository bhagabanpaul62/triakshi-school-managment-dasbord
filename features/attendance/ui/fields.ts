// One field definition per attendance entity, used by its create form and its edit form.
import type { Field } from "@smw/ui/shell/FormModal";
import { CONDONATION_REASONS } from "../constants";

export const holidayFields: Field[] = [
  { name: "date", label: "Date", type: "date", required: true },
  { name: "name", label: "Name", required: true, wide: true },
];

/** Applying for leave and editing a waiting request share these; only applying takes a file and (for a family login) a student. */
export const leaveFields = (opts: { kids?: { id: string; name: string }[]; file?: boolean } = {}): Field[] => [
  ...(opts.kids && opts.kids.length > 1 ? [{ name: "studentId", label: "Student", type: "select" as const, required: true, options: opts.kids.map((k) => ({ value: k.id, label: k.name })) }] : []),
  { name: "fromDate", label: "First day", type: "date", required: true },
  { name: "toDate", label: "Last day", type: "date", required: true },
  { name: "reason", label: "Reason", type: "textarea", required: true, wide: true },
  ...(opts.file ? [{ name: "file", label: "Note or document (optional)", type: "file" as const, accept: ".pdf,.png,.jpg,.jpeg,.webp", hint: "A doctor's note or letter, up to 15 MB.", wide: true }] : []),
];

/** A condonation: adding takes a document, editing keeps the one already there. */
export const condoneFields = (opts: { file?: boolean } = {}): Field[] => [
  { name: "reason", label: "Reason", type: "select", required: true, options: CONDONATION_REASONS.map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) })) },
  { name: "note", label: "Note", type: "textarea", wide: true },
  ...(opts.file ? [{ name: "file", label: "Document (optional)", type: "file" as const, accept: ".pdf,.png,.jpg,.jpeg,.webp", hint: "Medical certificate or sports letter, up to 15 MB.", wide: true }] : []),
];

export const settingFields: Field[] = [
  { name: "mode", label: "How attendance is taken", type: "select", required: true, wide: true,
    options: [{ value: "daily", label: "Once a day, by the class teacher" }, { value: "period", label: "Period by period, by each subject teacher" }],
    hint: "Period by period: the day is worked out from the periods, so registers and eligibility keep working. Teachers then mark from My classes." },
  { name: "rollupPercent", label: "A student is present for the day at (% of periods)", type: "number", min: 1, max: 100, required: true, hint: "Present or late in at least this share of the periods marked. 50 means half." },
  { name: "alertsEnabled", label: "Send an alert when a student is marked absent or late", type: "checkbox", wide: true },
  { name: "thresholdPercent", label: "Board eligibility threshold (%)", type: "number", min: 1, max: 100, required: true, hint: "Class 10 and 12 students below this over the academic year are listed." },
];

export const reverseFields: Field[] = [
  { name: "note", label: "Note to the requester", type: "textarea", wide: true, hint: "Approved becomes not approved and its leave days are cleared. Not approved becomes approved and the days are marked as leave." },
];
