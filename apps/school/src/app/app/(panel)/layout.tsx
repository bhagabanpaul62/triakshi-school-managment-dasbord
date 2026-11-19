import { AppShell, ShellBanner } from "@smw/ui/shell/AppShell";
import { panelCss } from "@smw/themes";
import { getSchool, requireCtx } from "@smw/runtime";
import { buildMenu, ROLE_LABEL } from "@/lib/menu";
import { logout } from "@/lib/auth-actions";
import { NotificationBellServer } from "@smw/feature-notifications/ui/bell-server";
import { MessageService } from "@smw/feature-messages/service";
import { AwaitingApproval } from "@smw/feature-setup/ui/awaiting-approval";
import { redirect } from "next/navigation";
import { Button } from "@smw/ui/ui/button";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const [school, ctx] = await Promise.all([getSchool(), requireCtx()]);
  // Platform approval gate: a newly registered school sees where it stands, nothing else.
  if (school.status === "pending" || school.status === "rejected") {
    return (
      <AwaitingApproval schoolName={school.name} status={school.status} email={school.row.email ?? undefined}>
        <form action={logout}><Button type="submit" variant="secondary" className="rounded-full">Sign out</Button></form>
      </AwaitingApproval>
    );
  }
  // First run after approval: the admin finishes the setup wizard before the panel.
  if (!school.setupCompleted && ctx.role === "admin" && !ctx.supportStaffId) redirect("/app/setup");
  // Sidebar badges: a failure here must never take the whole panel down.
  const unread = ctx.features.has("messages") ? await new MessageService(ctx).unreadCount().catch(() => 0) : 0;
  const banner = ctx.supportStaffId ? <ShellBanner tone="warning">Support session{ctx.readOnly ? " (read-only)" : ""}. Every action is logged.</ShellBanner>
    : school.readOnly ? <ShellBanner tone="danger">Your school is read-only. Renew the plan in Billing to make changes; exports still work.</ShellBanner>
    : school.status === "trial" && school.trialEndsAt ? <ShellBanner>Free trial: {Math.max(0, Math.ceil((school.trialEndsAt.getTime() - Date.now()) / 86_400_000))} days left.</ShellBanner>
    : null;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: panelCss(school.theme) }} />
      <AppShell brand={{ name: school.name, logoUrl: school.logoUrl, homeHref: "/app" }} groups={buildMenu(ctx, { "/app/messages": unread })}
        user={{ name: ctx.name, meta: ROLE_LABEL[ctx.role] }} logout={logout} banner={banner}
        topbar={ctx.features.has("notifications") ? <NotificationBellServer /> : null}>
        {children}
      </AppShell>
    </>
  );
}
