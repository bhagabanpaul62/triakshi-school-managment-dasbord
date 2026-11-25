import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "support",
  name: "Support",
  description: "Help articles, and questions to the Triakshi team with their replies.",
  stage: "ga",
  core: true,
  permissions: { use: ["admin", "accountant", "teacher"], all: ["admin"] },
  menu: [{ label: "Support", href: "/app/support", icon: "support", permission: "use", group: "admin", order: 90 }],
});
