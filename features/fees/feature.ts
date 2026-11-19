import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "fees",
  name: "Fees",
  description: "Fee heads, structures with installments, concessions, late fees, payments with numbered receipts, dues and the student ledger.",
  stage: "ga",
  requires: ["students", "academics"],
  permissions: {
    read: ["admin", "accountant"],
    manage: ["admin", "accountant"],
    /** Students and parents see only their own ledger and receipts. */
    self: ["student", "parent"],
  },
  menu: [
    { label: "Fees", href: "/app/fees", icon: "money", permission: "read", group: "finance", order: 10 },
    { label: "My fees", href: "/app/fees", icon: "money", permission: "self", group: "finance", order: 10 },
    { label: "Fee setup", href: "/app/fees/setup", icon: "receipt", permission: "manage", group: "finance", order: 11 },
  ],
});
