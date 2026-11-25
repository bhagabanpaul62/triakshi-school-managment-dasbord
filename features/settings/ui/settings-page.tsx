import Link from "next/link";
import { redirect } from "next/navigation";
import { IconAlertTriangle, IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { EmptyLine } from "@smw/ui/finance/States";
import { dateTime } from "@smw/ui/format";
import { HubFactsService, HubService } from "../hub-service";
import { SchoolProfileService } from "../service";
import { AdminOnly } from "./states";
import { settingsNav } from "./nav";

export const metadata = { title: "Settings" };

/** Old `?tab=` bookmarks land on the page that replaced the tab. */
const OLD_TABS: Record<string, string> = { school: "/app/settings/school", users: "/app/settings/users", roles: "/app/settings/roles", export: "/app/settings/export" };

const TONE_ICON = { danger: "text-[var(--ds-color-danger-400)]", warning: "text-[var(--ds-color-warning-400)]", info: "text-[var(--ds-on-surface-muted)]" } as const;

/** The Settings front page: what needs a look, then a few useful facts. The areas are the side list (the list itself on a phone), so they are not repeated as cards. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = (await searchParams).tab;
  if (typeof tab === "string" && OLD_TABS[tab]) redirect(OLD_TABS[tab]!);
  const ctx = await requireCtx();
  const groups = settingsNav(ctx);
  const manage = new SchoolProfileService(ctx).can("manage");
  if (!manage && !groups.length) return <AdminOnly title="Settings" />;
  const [items, facts] = manage ? await Promise.all([new HubService(ctx).attention(), new HubFactsService(ctx).facts().catch(() => null)]) : [[], null];
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Your school's details, who can sign in, your data and your plan." />
      {manage ? (
        <Panel title="Needs a look" className="mb-4">
          {items.length === 0 ? <EmptyLine title="Nothing needs attention." hint="The school profile is complete and sign-ins look normal." /> : (
            <ul className="flex flex-col gap-1">
              {items.map((i) => (
                <li key={i.key}>
                  <Link href={i.href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                    {i.tone === "info" ? <IconInfoCircle className={`h-4 w-4 shrink-0 ${TONE_ICON.info}`} aria-hidden /> : <IconAlertTriangle className={`h-4 w-4 shrink-0 ${TONE_ICON[i.tone]}`} aria-hidden />}
                    <span className="min-w-0 flex-1 text-[var(--ds-on-surface)]">{i.text}</span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {facts ? (
        <div className="hidden lg:block">
          <Panel title="At a glance">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              {([
                ["Plan", facts.plan ?? "-", "/app/billing", "Billing"],
                ["Admins", String(facts.admins), "/app/settings/users", facts.admins === 1 ? "Add a second" : "Open users"],
                ["Modules on", String(facts.modulesOn), "/app/settings/modules", "Open modules"],
                ["Last data export", facts.lastExport ? dateTime(facts.lastExport) : "Never", "/app/settings/export", facts.lastExport ? "Open exports" : "Make one"],
                ["Support access", facts.support === "always" ? "Always allowed" : facts.support === "never" ? "Never" : facts.supportOpen ? "Allowed for a while" : "Allowed time ran out", "/app/settings/access", "Change"],
              ] as const).map(([k, v, href, cta]) => (
                <div key={k} className="min-h-12 py-2">
                  <dt className="text-xs text-[var(--ds-on-surface-muted)]">{k}</dt>
                  <dd className="flex items-center justify-between gap-3 text-sm text-[var(--ds-on-surface)]">
                    <span className="truncate">{v}</span>
                    <Link href={href} className="shrink-0 text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">{cta}</Link>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
