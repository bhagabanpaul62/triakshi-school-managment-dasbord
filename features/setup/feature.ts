import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "setup",
  name: "Setup wizard",
  description: "The first-run wizard a newly approved school's admin goes through: profile, year, classes, subjects, students, staff, website.",
  stage: "ga",
  core: true,
  requires: ["settings", "academics"],
  permissions: { run: ["admin"] },
});
