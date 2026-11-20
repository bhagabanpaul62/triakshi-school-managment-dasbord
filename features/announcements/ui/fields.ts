import type { Field } from "@smw/ui/shell/FormModal";

export const announcementFields = (classes: { value: string; label: string }[]): Field[] => [
  { name: "title", label: "Title", required: true, wide: true },
  { name: "body", label: "Message", type: "textarea", required: true, wide: true },
  { name: "audience", label: "Send to", type: "select", required: true, hint: "Families sign in with the student login, so a family notice reaches the student accounts", options: [
    { value: "all", label: "Everyone" }, { value: "staff", label: "Staff only" }, { value: "students", label: "Students" },
    { value: "parents", label: "Families (student logins)" }, { value: "class", label: "One class" },
  ] },
  { name: "classId", label: "Which class", type: "select", options: classes, hint: "Only used when \"One class\" is chosen" },
  { name: "isPublic", label: "Website", type: "checkbox", placeholder: "Show on the school website" },
  { name: "pinned", label: "Pin", type: "checkbox", placeholder: "Keep at the top" },
];
