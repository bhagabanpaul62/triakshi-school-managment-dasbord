import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "meetings",
  name: "Meetings",
  description: "Parent-teacher meetings: time slots, family booking, the day's list, remarks.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    /** Families book for their child; teachers see their own slots. */
    use: ["admin", "teacher", "student"],
    manage: ["admin"],
  },
  menu: [{ label: "Meetings", href: "/app/meetings", icon: "clock", permission: "use", group: "communication", order: 25 }],
});
