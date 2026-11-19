import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "exams",
  name: "Exams and results",
  description: "Exams per term, marks entry, grade scales, ranked results and CBSE-style report cards.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "teacher"],
    manage: ["admin"],
    marks: ["admin", "teacher"],
    /** Students and parents see only their own published results. */
    self: ["student", "parent"],
  },
  menu: [
    { label: "Exams", href: "/app/exams", icon: "exam", permission: "read", group: "academics", order: 30 },
    { label: "Results", href: "/app/results", icon: "result", permission: "read", group: "academics", order: 31 },
    { label: "My results", href: "/app/results", icon: "result", permission: "self", group: "academics", order: 31 },
  ],
});
