import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "library",
  name: "Library",
  description: "Books and copies with accession numbers, issue and return, due dates, fines, member history and the overdue list.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "teacher"],
    /** Teachers cover the librarian's desk. */
    manage: ["admin", "teacher"],
    /** Students and parents see their own loans and fines. */
    self: ["student", "parent"],
  },
  menu: [{ label: "Library", href: "/app/library", icon: "library", permission: "read", group: "academics", order: 60 }],
});
