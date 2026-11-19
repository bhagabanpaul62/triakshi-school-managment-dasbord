import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "announcements",
  name: "Announcements",
  description: "Notices to the whole school, staff, students, parents or one class. Public ones appear on the website.",
  stage: "ga",
  permissions: {
    read: ["admin", "accountant", "teacher", "student", "parent"],
    write: ["admin", "teacher"],
  },
  menu: [{ label: "Announcements", href: "/app/announcements", icon: "megaphone", permission: "read", group: "communication", order: 10 }],
});
