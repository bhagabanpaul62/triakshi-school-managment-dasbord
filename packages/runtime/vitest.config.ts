import { dbTestConfig } from "@smw/db/vitest-config";
// students tables exist so a student's phase (left, alumni) can be tested; the runtime itself does not import them.
export default dbTestConfig("runtime", ["announcements", "academics", "students"]);
