import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "expenses",
  name: "Expenses",
  description: "Vendors, bills and approvals, payments, petty cash, staff claims, recurring costs, budgets and other income.",
  stage: "ga",
  requires: ["finance", "staff"],
  permissions: {
    read: ["admin", "accountant"],
    manage: ["admin", "accountant"],
    /** Ask for your own money back. */
    claim: ["admin", "accountant", "teacher", "staff"],
  },
  menu: [
    { label: "Expenses", href: "/app/expenses", icon: "receipt", permission: "read", group: "finance", order: 30 },
    { label: "Bills", href: "/app/expenses/bills", icon: "inbox", permission: "read", group: "finance", order: 31 },
    { label: "Vendors", href: "/app/expenses/vendors", icon: "users", permission: "read", group: "finance", order: 32 },
    { label: "Budgets", href: "/app/expenses/budgets", icon: "chart", permission: "read", group: "finance", order: 33 },
    { label: "My claims", href: "/app/expenses/claims", icon: "money", permission: "claim", group: "finance", order: 34 },
  ],
});
