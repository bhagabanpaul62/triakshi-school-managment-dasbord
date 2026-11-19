import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "notifications",
  name: "Notifications",
  description: "The bell: in-app notifications for announcements, fee dues and results, plus a daily email digest.",
  stage: "ga",
  core: true,
  permissions: {
    read: ["admin", "accountant", "teacher", "student", "parent"],
    /** Create notifications for other users (other features normally use NotificationWriter inside their own transaction). */
    send: ["admin", "accountant", "teacher"],
  },
});
