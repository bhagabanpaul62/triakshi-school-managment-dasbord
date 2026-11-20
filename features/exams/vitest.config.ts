import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("exams", ["students","academics","timetable","attendance","exams", "notifications", "assignments"]);
