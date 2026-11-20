import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "messages",
  name: "Messages",
  description: "Private conversations between staff and students of one school. Only members of a conversation can see it.",
  stage: "ga",
  requires: ["academics", "students"],
  permissions: {
    use: ["admin", "accountant", "teacher", "student"],
  },
  menu: [{ label: "Messages", href: "/app/messages", icon: "message", permission: "use", group: "communication", order: 30 }],
});
