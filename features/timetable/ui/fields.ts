import type { Field } from "@smw/ui/shell/FormModal";

export const periodFields: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "Period 1", wide: true },
  { name: "startsAt", label: "Starts", type: "time", required: true },
  { name: "endsAt", label: "Ends", type: "time", required: true },
  { name: "sortOrder", label: "Order in the day", type: "number", min: 1, required: true, hint: "1 is the first period" },
  { name: "isBreak", label: "Break", type: "checkbox", placeholder: "Recess or lunch: no class is held" },
];
