import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "timetable",
  name: "Timetable",
  description: "The bell schedule and the weekly timetable of every section, with teacher clash checks and a personal timetable for teachers.",
  stage: "ga",
  requires: ["academics"],
  permissions: {
    read: ["admin", "accountant", "teacher", "student"],
    manage: ["admin"],
  },
  menu: [{ label: "Timetable", href: "/app/timetable", icon: "clock", permission: "read", group: "academics", order: 20 }],
});
