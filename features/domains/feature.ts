import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "domains",
  name: "Custom domains",
  description: "Serve the school website and panel on the school's own domain, with HTTPS.",
  stage: "ga",
  permissions: {
    read: ["admin"],
    manage: ["admin"],
  },
  menu: [{ label: "Domain", href: "/app/domains", icon: "domain", permission: "read", group: "website", order: 30 }],
});
