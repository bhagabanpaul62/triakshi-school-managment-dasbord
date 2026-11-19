import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "staff",
  name: "Staff",
  description: "Teachers, accountants and admins: employee records, invites, roles and who teaches what.",
  stage: "ga",
  requires: ["academics"],
  permissions: {
    read: ["admin", "accountant", "teacher"],
    write: ["admin"],
  },
  menu: [{ label: "Staff", href: "/app/staff", icon: "teacher", permission: "read", group: "people", order: 20 }],
});
