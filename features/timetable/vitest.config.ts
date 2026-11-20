import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("timetable", ["academics", "students", "attendance", "notifications", "timetable"]);
