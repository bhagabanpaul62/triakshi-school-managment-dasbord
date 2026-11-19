import { defineFeature } from "@smw/feature-kit";

/** Declared here so BillingService can extend SchoolService; features/billing/feature.ts default-exports it. */
export const billingFeature = defineFeature({
  key: "billing",
  name: "Billing",
  description: "Your plan, usage against the student cap, GST invoices and payment to Triakshi.",
  stage: "ga",
  core: true,
  permissions: { read: ["admin", "accountant"], manage: ["admin"] },
  menu: [{ label: "Billing", href: "/app/billing", icon: "billing", permission: "read", group: "admin", order: 90 }],
});
