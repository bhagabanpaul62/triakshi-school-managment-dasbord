import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "events",
  name: "Calendar",
  description: "School calendar: events, trips, answers (RSVP), reminders and your phone calendar. Public ones appear on the website.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "accountant", "teacher", "student"],
    write: ["admin", "teacher"],
    manage: ["admin"],
  },
  menu: [{ label: "Calendar", href: "/app/events", icon: "event", permission: "read", group: "communication", order: 20 }],
});
