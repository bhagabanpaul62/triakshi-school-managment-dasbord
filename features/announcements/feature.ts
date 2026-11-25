import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "announcements",
  name: "Notices",
  description: "Notices, circulars and urgent alerts to the school, one class or one family, with approval, answers and a report of who has seen them.",
  stage: "ga",
  requires: ["academics", "students"],
  permissions: {
    read: ["admin", "accountant", "teacher", "student"],
    draft: ["admin", "accountant", "teacher"],
    publish: ["admin", "accountant", "teacher"],
    approve: ["admin"],
    urgent: ["admin"],
    manage: ["admin"],
  },
  menu: [{ label: "Notices", href: "/app/announcements", icon: "megaphone", permission: "read", group: "communication", order: 10 }],
});
