import { defineFeature } from "@smw/feature-kit";

export default defineFeature({
  key: "payroll",
  name: "Payroll",
  description: "Salaries for teachers and staff: structures, monthly runs, payslips, loans, PF, ESI and tax, exits and statements.",
  stage: "ga",
  requires: ["finance", "staff"],
  permissions: {
    read: ["admin", "accountant"],
    manage: ["admin", "accountant"],
    /** Your own payslips. */
    self: ["admin", "accountant", "teacher", "staff"],
  },
  menu: [
    { label: "Payroll", href: "/app/payroll", icon: "money", permission: "read", group: "finance", order: 40 },
    { label: "Pay runs", href: "/app/payroll/runs", icon: "calendar", permission: "read", group: "finance", order: 41 },
    { label: "Pay and people", href: "/app/payroll/people", icon: "teacher", permission: "read", group: "finance", order: 42 },
    { label: "My payslips", href: "/app/payroll/me", icon: "receipt", permission: "self", group: "finance", order: 43 },
  ],
});
