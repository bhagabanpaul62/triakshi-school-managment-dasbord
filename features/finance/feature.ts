import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "finance",
  name: "Finance",
  description: "The school's ledger: accounts, cash and bank, approvals, document layouts, bank matching, statements and year close.",
  stage: "ga",
  core: true,
  permissions: {
    read: ["admin", "accountant"],
    /** Manual entries and transfers. */
    journal: ["admin", "accountant"],
    reconcile: ["admin", "accountant"],
    approve: ["admin"],
    close: ["admin"],
    settings: ["admin"],
  },
  menu: [
    { label: "Finance", href: "/app/finance", icon: "chart", permission: "read", group: "finance", order: 1 },
    { label: "Approvals", href: "/app/finance/approvals", icon: "check", permission: "approve", group: "finance", order: 2 },
    { label: "Accounts", href: "/app/finance/accounts", icon: "book", permission: "read", group: "finance", order: 50 },
    { label: "Banking", href: "/app/finance/banking", icon: "inbox", permission: "reconcile", group: "finance", order: 51 },
    { label: "Statements", href: "/app/finance/statements", icon: "report", permission: "read", group: "finance", order: 52 },
    { label: "Year close", href: "/app/finance/year-close", icon: "calendar", permission: "close", group: "finance", order: 53 },
    { label: "Finance setup", href: "/app/finance/settings", icon: "settings", permission: "settings", group: "finance", order: 60 },
    { label: "Document layouts", href: "/app/finance/templates", icon: "receipt", permission: "read", group: "finance", order: 61 },
  ],
});
