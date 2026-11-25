import { allows, type Ctx } from "@smw/feature-kit";
import settingsFeature from "../feature";

export interface NavItem { href: string; label: string; hint: string }
export interface NavGroup { key: string; label: string; items: NavItem[] }

/** `key:permission` held by an admin by default: the same rule the page itself applies, so the list never offers a page that refuses. */
const may = (ctx: Ctx, key: string, perm: string, roles: ("admin" | "accountant")[] = ["admin"]) => allows(ctx, { key, permissions: { [perm]: roles } }, perm);

/** The Settings side list for this person: grouped, and only the pages that module and permission allow. */
export function settingsNav(ctx: Ctx): NavGroup[] {
  const on = (k: string) => ctx.features.has(k);
  const manage = allows(ctx, settingsFeature, "manage");
  const groups: NavGroup[] = [
    { key: "school", label: "School", items: [
      ...(manage ? [{ href: "/app/settings/school", label: "School profile", hint: "Name, address, board, head of school, GSTIN" }] : []),
      ...(on("website") && may(ctx, "website", "read") ? [{ href: "/app/theme", label: "Branding and theme", hint: "Logo, colours and fonts" }] : []),
      ...(on("academics") && may(ctx, "academics", "manage") ? [{ href: "/app/academics/years", label: "Academic years", hint: "Years and terms" }] : []),
    ] },
    { key: "people", label: "People", items: manage ? [
      { href: "/app/settings/users", label: "Users", hint: "Who can sign in, add a login, reset passwords" },
      { href: "/app/settings/roles", label: "Roles", hint: "What each kind of person can do" },
      { href: "/app/settings/sign-ins", label: "Sign-in activity", hint: "Every sign-in and failed try" },
    ] : [] },
    { key: "data", label: "Your data", items: [
      ...(allows(ctx, settingsFeature, "audit") ? [{ href: "/app/audit", label: "Audit log", hint: "Who changed what, and when" }] : []),
      ...(allows(ctx, settingsFeature, "export") ? [{ href: "/app/settings/export", label: "Data export", hint: "Take all your data out" }] : []),
      ...(allows(ctx, settingsFeature, "privacy") ? [{ href: "/app/settings/privacy", label: "Privacy requests", hint: "Requests about personal data" }] : []),
      ...(manage ? [
        { href: "/app/settings/access", label: "Support access", hint: "When Triakshi may open your school" },
        { href: "/app/settings/account", label: "Account", hint: "Alerts, keeping times, closing the account" },
      ] : []),
    ] },
    { key: "plan", label: "Modules and plan", items: manage ? [
      { href: "/app/settings/modules", label: "Modules", hint: "What your plan includes and what is in use" },
      ...(on("billing") ? [{ href: "/app/billing", label: "Billing", hint: "Plan, invoices and payments" }] : []),
    ] : [] },
    { key: "areas", label: "Areas", items: [
      ...(on("notifications") && may(ctx, "notifications", "manage") ? [{ href: "/app/settings/communication", label: "Communication", hint: "Channels, quiet hours, limits" }, { href: "/app/settings/delivery", label: "Delivery report", hint: "Mail and push that went out or failed" }] : []),
      ...(on("finance") && may(ctx, "finance", "settings") ? [{ href: "/app/finance/settings", label: "Finance", hint: "Cash and bank accounts, number series, rules" }] : []),
      ...(on("website") && may(ctx, "website", "manage") ? [{ href: "/app/website/settings", label: "Website", hint: "Notice bar, buttons, search engines, redirects" }] : []),
      ...(on("domains") && may(ctx, "domains", "read") ? [{ href: "/app/domains", label: "Domain", hint: "Your own web address" }] : []),
      ...(on("setup") && may(ctx, "setup", "run") ? [{ href: "/app/getting-started", label: "Getting started", hint: "What is left to set up" }] : []),
    ] },
  ];
  return groups.filter((g) => g.items.length);
}
