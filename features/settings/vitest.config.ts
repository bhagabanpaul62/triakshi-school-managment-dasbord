import { dbTestConfig } from "@smw/db/vitest-config";
// academics + students, finance + payroll: the export tests need real student and salary tables.
export default dbTestConfig("settings", ["academics", "students", "finance", "payroll", "settings"]);
