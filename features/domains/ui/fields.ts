import type { Field } from "@smw/ui/shell/FormModal";

export const domainFields: Field[] = [
  { name: "hostname", label: "Your domain", required: true, wide: true, placeholder: "www.myschool.in", hint: "Only the domain: no http:// and no path. A www address works best." },
];
