import { dbTestConfig } from "@smw/db/vitest-config";
// settings (school profile), students and staff (counts and invites), announcements + events + website (publish step).
export default dbTestConfig("setup", ["notifications", "academics", "students", "staff", "settings", "announcements", "events", "website", "setup"]);
