import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import { dbTestConfig } from "@smw/db/vitest-config";


export default mergeConfig(dbTestConfig("school-api", ["academics", "students", "announcements", "messages", "notifications", "events", "requests", "meetings", "attendance", "assignments", "exams", "timetable", "fees", "staff", "finance", "expenses", "payroll", "website", "settings"]), { resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } } });
