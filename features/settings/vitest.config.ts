import { dbTestConfig } from "@smw/db/vitest-config";
// academics + students: the export tests need a real students table.
export default dbTestConfig("settings", ["academics", "students", "settings"]);
