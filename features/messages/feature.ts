import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "messages",
  name: "Messages",
  description: "Private conversations between staff and families of one school, with one conversation per family. The school can review a conversation for safety, and both sides are told.",
  stage: "ga",
  requires: ["academics", "students"],
  permissions: {
    use: ["admin", "accountant", "teacher", "student"],
    all: ["admin", "accountant"],
    safeguard: ["admin"],
    manage: ["admin"],
  },
  menu: [
    { label: "Messages", href: "/app/messages", icon: "message", permission: "use", group: "communication", order: 30 },
    { label: "Safeguarding", href: "/app/safeguarding", icon: "shield", permission: "safeguard", group: "communication", order: 60 },
  ],
});
