import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "academics",
  name: "Academic setup",
  description: "Academic years, terms, classes, sections, subjects and who teaches what.",
  stage: "ga",
  permissions: {
    read: ["admin", "accountant", "teacher", "student", "parent"],
    manage: ["admin"],
  },
  menu: [
    { label: "Classes", href: "/app/academics/classes", icon: "class", permission: "read", group: "academics", order: 10 },
    { label: "Subjects", href: "/app/academics/subjects", icon: "subject", permission: "manage", group: "academics", order: 11 },
    { label: "Academic years", href: "/app/academics/years", icon: "calendar", permission: "manage", group: "admin", order: 20 },
  ],
});
