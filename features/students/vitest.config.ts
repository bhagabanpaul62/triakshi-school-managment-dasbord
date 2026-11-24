import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("students", ["academics", "students", "fees", "finance", "notifications"]);
