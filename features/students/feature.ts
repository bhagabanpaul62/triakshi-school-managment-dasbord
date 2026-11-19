import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "students",
  name: "Students and parents",
  description: "Admissions, student records, guardians and parent logins, documents, consent, import and promotion.",
  stage: "ga",
  requires: ["academics"],
  permissions: {
    read: ["admin", "accountant", "teacher"],
    write: ["admin"],
    /** Students and parents see only their own records. */
    self: ["student", "parent"],
  },
  menu: [
    { label: "Students", href: "/app/students", icon: "users", permission: "read", group: "people", order: 10 },
    { label: "Parents", href: "/app/parents", icon: "parent", permission: "read", group: "people", order: 12 },
  ],
});
