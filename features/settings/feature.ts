import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "settings",
  name: "Settings",
  description: "School profile and logo, users and roles, your own profile, the audit log and data export.",
  stage: "ga",
  core: true,
  permissions: {
    read: ["admin", "accountant", "teacher", "student", "parent"],
    manage: ["admin"],
    audit: ["admin"],
    export: ["admin"],
  },
  menu: [
    { label: "Settings", href: "/app/settings", icon: "settings", permission: "manage", group: "admin", order: 10 },
    { label: "Audit log", href: "/app/audit", icon: "shield", permission: "audit", group: "admin", order: 20 },
    { label: "My profile", href: "/app/profile", icon: "user", permission: "read", group: "main", order: 90 },
  ],
});
