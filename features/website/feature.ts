import { defineFeature } from "@smw/feature-kit";

/**
 * Permission "public" exists only so the public website can act through `systemCtx()` (role admin) when it
 * reads the published site and records an admission enquiry. No signed-in role uses it; it is granted to "admin"
 * because that is the role of a system context. See PublicSiteService.
 */
export default defineFeature({
  key: "website",
  name: "Website and theme",
  description: "A themed public school website on your address, an editor for its pages, and the admission enquiry pipeline.",
  stage: "ga",
  requires: ["announcements", "events"],
  permissions: {
    read: ["admin"],
    manage: ["admin"],
    publish: ["admin"],
    enquiries: ["admin", "accountant"],
    pipeline: ["admin"],
    public: ["admin"],
  },
  menu: [
    { label: "Website", href: "/app/website", icon: "web", permission: "read", also: ["manage", "publish"], group: "website", order: 10 },
    { label: "Enquiries", href: "/app/enquiries", icon: "inbox", permission: "enquiries", group: "website", order: 20 },
    { label: "Theme", href: "/app/theme", icon: "palette", permission: "manage", group: "website", order: 40 },
  ],
});
