import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "fees",
  name: "Fees",
  description: "Fee plans, bills, receipts, concessions, settlements, refunds, the cash counter and the student's money record.",
  stage: "ga",
  requires: ["students", "academics", "finance"],
  permissions: {
    read: ["admin", "accountant"],
    collect: ["admin", "accountant"],
    setup: ["admin", "accountant"],
    concede: ["admin", "accountant"],
    /** Students see only their own bills and receipts. */
    self: ["student"],
  },
  menu: [
    { label: "Fees", href: "/app/fees", icon: "money", permission: "read", group: "finance", order: 10 },
    { label: "Collect", href: "/app/fees/collect", icon: "receipt", permission: "collect", group: "finance", order: 11 },
    { label: "Invoices", href: "/app/fees/invoices", icon: "report", permission: "read", group: "finance", order: 12 },
    { label: "Students' dues", href: "/app/fees/dues", icon: "clock", permission: "read", group: "finance", order: 13 },
    { label: "Fee plans", href: "/app/fees/plans", icon: "book", permission: "setup", group: "finance", order: 14 },
    { label: "Concessions", href: "/app/fees/concessions", icon: "check", permission: "concede", group: "finance", order: 15 },
    { label: "Receipts", href: "/app/fees/receipts", icon: "inbox", permission: "read", group: "finance", order: 16 },
    { label: "My fees", href: "/app/fees", icon: "money", permission: "self", group: "finance", order: 10 },
  ],
});
