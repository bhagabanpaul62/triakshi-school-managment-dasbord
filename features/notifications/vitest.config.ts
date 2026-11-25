import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("notifications", ["notifications", "students", "academics", "transport", "fees", "finance"]);
