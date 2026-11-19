import type { Field } from "@smw/ui/shell/FormModal";

export const ticketFields: Field[] = [
  { name: "subject", label: "What is this about?", required: true, wide: true, placeholder: "For example: Fee receipts are not printing" },
  { name: "priority", label: "How urgent", type: "select", options: [
    { value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent: school work is blocked" },
  ] },
  { name: "body", label: "Tell us more", type: "textarea", required: true, hint: "What you did, what you expected, what happened." },
];

export const TICKET_TONES = { open: "info", pending: "warning", resolved: "success", closed: "default" } as const;
export const TICKET_LABELS = { open: "Open", pending: "Waiting for you", resolved: "Resolved", closed: "Closed" } as const;

export const PRIORITY_LABELS = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as const;
