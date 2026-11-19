import { AppShell } from "@smw/ui/shell/AppShell";
import { ApprovalService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { logout } from "@/lib/auth-actions";
import { ROLE_LABELS } from "@/lib/tones";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const pending = await new ApprovalService(staff).pendingCount();
  const groups = [
    { label: "Platform", items: [
      { label: "Overview", href: "/", icon: "home" },
      { label: "Approvals", href: "/approvals", icon: "check", badge: pending },
      { label: "Schools", href: "/schools", icon: "class" },
      { label: "Plans", href: "/plans", icon: "receipt" },
      { label: "Modules", href: "/modules", icon: "settings" },
      { label: "Domains", href: "/domains", icon: "domain" },
    ] },
    { label: "Business", items: [
      { label: "Billing", href: "/billing", icon: "billing" },
      { label: "Support", href: "/support", icon: "support" },
      { label: "Design requests", href: "/design-requests", icon: "palette" },
    ] },
    { label: "Team", items: [
      ...(staff.role === "owner" ? [{ label: "Staff", href: "/staff", icon: "users" }] : []),
      { label: "Audit log", href: "/audit", icon: "shield" },
    ] },
  ];
  return (
    <AppShell brand={{ name: "Triakshi Console", homeHref: "/" }} groups={groups} user={{ name: staff.name, meta: ROLE_LABELS[staff.role] ?? staff.role }} logout={logout}>
      {children}
    </AppShell>
  );
}
