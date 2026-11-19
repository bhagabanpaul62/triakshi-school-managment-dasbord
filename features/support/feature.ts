import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "support",
  name: "Support",
  description: "Raise a question or problem with the Triakshi team and follow the replies.",
  stage: "ga",
  core: true,
  permissions: { use: ["admin"] },
  menu: [{ label: "Support", href: "/app/support", icon: "support", permission: "use", group: "admin", order: 90 }],
});
