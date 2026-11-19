import { dbTestConfig } from "@smw/db/vitest-config";
// students (and academics, which it requires) are listed because school lists count active students.
export default dbTestConfig("platform", ["academics", "students", "support"]);
