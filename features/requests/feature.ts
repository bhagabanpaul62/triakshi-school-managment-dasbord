import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "requests",
  name: "Requests",
  description: "One office inbox: families ask, the right person answers, with states, target days and escalation.",
  stage: "ga",
  requires: ["messages", "students", "academics"],
  permissions: {
    /** Raise and follow own requests; staff see the ones they own. */
    use: ["admin", "accountant", "teacher", "student"],
    /** See and work the whole queue (except complaints about yourself). */
    office: ["admin", "accountant"],
    /** Categories, owners, targets and the report. */
    manage: ["admin"],
  },
  menu: [{ label: "Requests", href: "/app/requests", icon: "inbox", permission: "use", group: "communication", order: 35 }],
});
