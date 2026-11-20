import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "attendance",
  name: "Attendance",
  description: "Daily or period-wise attendance for students, staff attendance, monthly registers, subject-wise percentages, defaulters and trends.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    mark: ["admin", "teacher"],
    read: ["admin", "teacher", "accountant"],
    /** Students (the family login) see only their own record. */
    self: ["student"],
    /** Staff attendance and holidays. */
    manage: ["admin"],
    /** Apply for leave: students (the family login) for themselves, staff for themselves. Who may decide is in the service. */
    leave: ["student", "teacher", "admin", "accountant", "staff"],
    /** Decide leave requests: a teacher only for their own sections' students, the admin for everyone. */
    approve: ["admin", "teacher"],
  },
  menu: [
    { label: "Attendance", href: "/app/attendance", icon: "check", permission: "read", group: "academics", order: 20 },
    { label: "Attendance", href: "/app/attendance", icon: "check", permission: "self", group: "academics", order: 20 },
    { label: "My classes", href: "/app/attendance/periods", icon: "check", permission: "mark", group: "academics", order: 19 },
    { label: "Register", href: "/app/attendance/register", icon: "calendar", permission: "read", group: "academics", order: 21 },
    { label: "Staff attendance", href: "/app/attendance/staff", icon: "teacher", permission: "manage", group: "people", order: 30 },
    { label: "Leave requests", href: "/app/attendance/leave-requests", icon: "check", permission: "approve", group: "academics", order: 23 },
    { label: "My leave", href: "/app/attendance/my-leave", icon: "calendar", permission: "leave", group: "academics", order: 24 },
    { label: "Board eligibility", href: "/app/attendance/eligibility", icon: "check", permission: "read", group: "academics", order: 25 },
    { label: "Holidays", href: "/app/attendance/holidays", icon: "calendar", permission: "manage", group: "academics", order: 22 },
  ],
});
