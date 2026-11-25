import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("events", ["notifications", "academics", "students", "timetable", "attendance", "staff", "finance", "expenses", "payroll", "exams", "assignments", "fees", "meetings", "events"]);
