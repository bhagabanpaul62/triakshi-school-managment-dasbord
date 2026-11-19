import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "attendance",
  name: "Attendance",
  description: "Daily attendance for students and staff, monthly registers, defaulters and trends.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    mark: ["admin", "teacher"],
    read: ["admin", "teacher", "accountant"],
    /** Students and parents see only their own (or their child's) record. */
    self: ["student", "parent"],
    /** Staff attendance and holidays. */
    manage: ["admin"],
  },
  menu: [
    { label: "Attendance", href: "/app/attendance", icon: "check", permission: "read", group: "academics", order: 20 },
    { label: "Attendance", href: "/app/attendance", icon: "check", permission: "self", group: "academics", order: 20 },
    { label: "Register", href: "/app/attendance/register", icon: "calendar", permission: "read", group: "academics", order: 21 },
    { label: "Staff attendance", href: "/app/attendance/staff", icon: "teacher", permission: "manage", group: "people", order: 30 },
    { label: "Holidays", href: "/app/attendance/holidays", icon: "calendar", permission: "manage", group: "academics", order: 22 },
  ],
});
