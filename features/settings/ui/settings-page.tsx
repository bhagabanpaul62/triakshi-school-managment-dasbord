import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { SchoolProfileService } from "../service";
import { ExportTab } from "./export-tab";
import { SchoolTab } from "./school-tab";
import { AdminOnly } from "./states";
import { UrlTabs } from "./tabs";
import { UsersTab } from "./users-tab";

export const metadata = { title: "Settings" };

const TABS = [
  { id: "school", label: "School profile" },
  { id: "users", label: "Users and roles" },
  { id: "export", label: "Data export" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (!new SchoolProfileService(ctx).can("manage")) return <AdminOnly title="Settings" />;
  const params = await searchParams;
  const tab = TABS.find((t) => t.id === params.tab)?.id ?? "school";
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Your school's details, who can sign in, and your data." />
      <UrlTabs tabs={TABS} value={tab} label="Settings sections" panelId="settings-panel" />
      <div id="settings-panel" role="tabpanel" className="pt-6">
        {tab === "school" ? <SchoolTab ctx={ctx} /> : tab === "users" ? <UsersTab ctx={ctx} searchParams={params} /> : <ExportTab ctx={ctx} />}
      </div>
    </>
  );
}
