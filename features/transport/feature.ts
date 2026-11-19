import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "transport",
  name: "Transport",
  description: "Vehicles, drivers, routes with stop times, student assignment, route-wise lists and the monthly transport fee.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "accountant", "teacher"],
    manage: ["admin"],
    /** Students and parents see their own route, stop and times. */
    self: ["student", "parent"],
  },
  menu: [{ label: "Transport", href: "/app/transport", icon: "bus", permission: "read", group: "people", order: 40 }],
});
