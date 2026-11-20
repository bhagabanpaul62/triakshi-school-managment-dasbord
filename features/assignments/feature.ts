import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "assignments",
  name: "Assignments",
  description: "Homework with due dates and attachments, student submissions with files, teacher grading and feedback.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "teacher"],
    write: ["admin", "teacher"],
    submit: ["student"],
    /** Students see their own work. */
    self: ["student"],
  },
  // One page, two audiences: the shell shows each role exactly one of these.
  menu: [
    { label: "Assignments", href: "/app/assignments", icon: "assignment", permission: "read", group: "academics", order: 30 },
    { label: "Assignments", href: "/app/assignments", icon: "assignment", permission: "self", group: "academics", order: 30 },
  ],
});
