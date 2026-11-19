import type { Field } from "@smw/ui/shell/FormModal";

export const createSchoolFields = (plans: { id: string; label: string }[]): Field[] => [
  { name: "name", label: "School name", required: true, wide: true },
  { name: "slug", label: "Web address", required: true, placeholder: "stmarys", hint: "Becomes stmarys.<your domain>. Letters, digits, hyphens." },
  { name: "planId", label: "Plan", type: "select", options: plans.map((p) => ({ value: p.id, label: p.label })) },
  { name: "adminName", label: "Administrator", required: true },
  { name: "adminEmail", label: "Administrator email", type: "email", required: true, hint: "They get an email to set a password." },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "board", label: "Board", type: "select", options: ["CBSE", "ICSE", "State board", "IB", "Other"].map((b) => ({ value: b, label: b })) },
  { name: "trialDays", label: "Trial days", type: "number", min: 1, max: 90, placeholder: "30" },
];
