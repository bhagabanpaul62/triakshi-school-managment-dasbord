import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "students",
  name: "Students and guardians",
  description: "Admissions, student records and logins, guardian contacts, documents, consent, import and promotion.",
  stage: "ga",
  requires: ["academics"],
  permissions: {
    read: ["admin", "accountant", "teacher"],
    write: ["admin"],
    /** Students (the family login) see only their own record. */
    self: ["student"],
  },
  menu: [
    { label: "Students", href: "/app/students", icon: "users", permission: "read", group: "people", order: 10 },
    { label: "Guardians", href: "/app/parents", icon: "parent", permission: "read", group: "people", order: 12 },
  ],
});
