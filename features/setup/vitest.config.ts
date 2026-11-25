import { dbTestConfig } from "@smw/db/vitest-config";
// settings (school profile), students and staff (counts and invites), announcements + events + website (publish step),
// support (Ask us), and every module that owns a table a getting-started task reads.
export default dbTestConfig("setup", [
  "notifications", "academics", "students", "staff", "settings", "announcements", "events", "website", "setup", "support", "domains",
  "attendance", "timetable", "assignments", "exams", "library", "transport", "finance", "fees", "payroll", "expenses",
]);
