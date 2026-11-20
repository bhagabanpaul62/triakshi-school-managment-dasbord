import { defineFeature } from "@smw/feature-kit";

/** The role home pages at /app. No menu item: Home is already in the sidebar. */
export default defineFeature({
  key: "home",
  name: "Home",
  description: "A home page for each role that answers what is happening today and what to do next.",
  stage: "ga",
  core: true,
  permissions: { view: ["admin", "accountant", "teacher", "student", "staff"] },
});
