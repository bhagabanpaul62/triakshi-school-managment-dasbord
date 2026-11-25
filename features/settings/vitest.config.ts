import { dbTestConfig } from "@smw/db/vitest-config";
// academics + students, finance + payroll, communication: the export tests need real student, salary and conversation tables.
export default dbTestConfig("settings", ["academics", "students", "finance", "payroll", "messages", "requests", "notifications", "events", "meetings", "settings"]);
