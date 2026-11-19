import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "events",
  name: "Events",
  description: "School calendar: events, holidays and programmes for a group or the whole school. Public ones appear on the website.",
  stage: "ga",
  permissions: {
    read: ["admin", "accountant", "teacher", "student", "parent"],
    write: ["admin", "teacher"],
  },
  menu: [{ label: "Events", href: "/app/events", icon: "event", permission: "read", group: "communication", order: 20 }],
});
