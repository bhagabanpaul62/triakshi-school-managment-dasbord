import { dbTestConfig } from "@smw/db/vitest-config";
export default dbTestConfig("attendance", ["students","academics","timetable","attendance","notifications","staff","finance","expenses","payroll"]);
