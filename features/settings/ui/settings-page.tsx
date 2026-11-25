import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import type { Catalogue } from "../catalogue";
import { SchoolProfileService } from "../service";
import { ExportTab } from "./export-tab";
import { RolesTab, type RoleActions } from "./roles-tab";
import { SchoolTab } from "./school-tab";
import { AdminOnly } from "./states";
import { UrlTabs } from "./tabs";
import { UsersTab } from "./users-tab";

export const metadata = { title: "Settings" };

const LINK = "inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

const TABS = [
  { id: "school", label: "School profile" },
  { id: "users", label: "Users" },
  { id: "roles", label: "Roles" },
  { id: "export", label: "Data export" },
];

/** `catalogue` and `roleActions` come from the school app's route file: it alone can import every feature. */
export default async function SettingsPage({ searchParams, catalogue, roleActions }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>; catalogue: Catalogue; roleActions: RoleActions;
}) {
  const ctx = await requireCtx();
  if (!new SchoolProfileService(ctx).can("manage")) return <AdminOnly title="Settings" />;
  const params = await searchParams;
  const tab = TABS.find((t) => t.id === params.tab)?.id ?? "school";
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Your school's details, who can sign in and what they can do, and your data."
        actions={<>
          <Link href="/app/settings/communication" className={LINK}>Communication settings</Link>
          <Link href="/app/notifications/delivery" className={LINK}>Delivery report</Link>
        </>} />
      <UrlTabs tabs={TABS} value={tab} label="Settings sections" panelId="settings-panel" />
      <div id="settings-panel" role="tabpanel" className="pt-6">
        {tab === "school" ? <SchoolTab ctx={ctx} /> : tab === "users" ? <UsersTab ctx={ctx} searchParams={params} /> : tab === "roles" ? <RolesTab ctx={ctx} catalogue={catalogue} actions={roleActions} /> : <ExportTab ctx={ctx} />}
      </div>
    </>
  );
}
