import type { Field } from "@smw/ui/shell/FormModal";

export const domainFields: Field[] = [
  { name: "hostname", label: "Your domain", required: true, wide: true, placeholder: "www.myschool.in", hint: "Only the domain: no http:// and no path. A www address works best." },
  { name: "pair", label: "Both forms", type: "checkbox", wide: true, placeholder: "Also add the other form (school.in with www.school.in), so both open your school" },
];

/** Typed confirmation for removing a live domain. */
export const removeFields = (hostname: string): Field[] => [
  { name: "confirm", label: `Type ${hostname} to confirm`, required: true, wide: true, placeholder: hostname, hint: "Your school stops opening on this address right away. Your free address keeps working." },
];
