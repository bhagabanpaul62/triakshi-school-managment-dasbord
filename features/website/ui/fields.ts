import type { Field } from "@smw/ui/shell/FormModal";
import { ENQUIRY_STATUSES } from "../schema";

export const STATUS_LABELS: Record<string, string> = { new: "New", contacted: "Contacted", visited: "Visited", admitted: "Admitted", closed: "Closed" };

export const enquiryUpdateFields: Field[] = [
  { name: "status", label: "Stage", type: "select", required: true, options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s]! })) },
  { name: "notes", label: "Notes", type: "textarea", hint: "Only your team sees these." },
];

export const enquiryCreateFields: Field[] = [
  { name: "studentName", label: "Child's name", required: true },
  { name: "dob", label: "Date of birth", type: "date" },
  { name: "classApplying", label: "Class applying for" },
  { name: "parentName", label: "Parent or guardian", required: true },
  { name: "phone", label: "Mobile number", type: "tel", required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "source", label: "How did they reach you?", type: "select", options: [{ value: "phone", label: "Phone call" }, { value: "walk-in", label: "Walk-in" }, { value: "referral", label: "Referral" }] },
  { name: "message", label: "Message", type: "textarea" },
];
