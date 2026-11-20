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
    /** Report card remarks. Teachers write them only for the section they are class teacher of (the service checks). */
    remarks: ["admin", "teacher"],
    /** Co-scholastic grades. Same class-teacher rule as remarks. */
    coscholastic: ["admin", "teacher"],
    /** Students see only their own published results. */
    self: ["student"],
  },
  menu: [
    { label: "Exams", href: "/app/exams", icon: "exam", permission: "read", group: "academics", order: 30 },
    { label: "Results", href: "/app/results", icon: "result", permission: "read", group: "academics", order: 31 },
    { label: "Report setup", href: "/app/exams/scales", icon: "exam", permission: "manage", group: "academics", order: 32 },
    { label: "Co-scholastic", href: "/app/exams/co-scholastic", icon: "exam", permission: "coscholastic", group: "academics", order: 33 },
    { label: "Remarks", href: "/app/exams/remarks", icon: "exam", permission: "remarks", group: "academics", order: 34 },
    { label: "My results", href: "/app/results", icon: "result", permission: "self", group: "academics", order: 31 },
  ],
});
