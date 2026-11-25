import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "setup",
  name: "Setup wizard",
  description: "The first-run wizard a newly approved school's admin goes through: profile, year, classes, subjects, students, staff, website.",
  stage: "ga",
  core: true,
  requires: ["settings", "academics"],
  // `task`: anyone who signs in may see and do the getting-started tasks given to them.
  permissions: { run: ["admin"], task: ["admin", "accountant", "teacher", "staff"] },
  menu: [
    { label: "Getting started", href: "/app/getting-started", icon: "check", permission: "run", group: "main", order: 5 },
    // Someone who was given a setup task finds it here; the menu shows it only while they have one open (and never to the admin, who has the whole list).
    { label: "Your setup tasks", href: "/app/getting-started?mine=1", icon: "check", permission: "task", group: "main", order: 6 },
  ],
});
