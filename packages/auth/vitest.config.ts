import { dbTestConfig } from "@smw/db/vitest-config";
// academics + students tables exist so the date-of-birth rule can be tested; auth itself does not import them.
export default dbTestConfig("auth", ["academics", "students"]);
