import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { MenuIconView } from "@smw/ui/shell/icons";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import type { StaffHome } from "../home-service";
import { Rows, SlotPanel } from "./layout";
import { AnnouncementsBody, open } from "./parts";

/** A role without a dashboard of its own: links to what it may open, and the school's announcements. */
export function StaffHomeView({ d }: { d: StaffHome }) {
  return (
    <Rows>
      <Panel title="Your pages">
        {d.links.length === 0 ? (
          <WidgetEmptyState title="Nothing is open to your role yet." description="Ask the school office to give your role access to a module." />
        ) : (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {d.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm ${ROW_HOVER} focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`}>
                  <MenuIconView name={l.icon} className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" />
                  <span className="min-w-0 truncate">{l.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <SlotPanel slot={d.announcements} title="Announcements" action={open("/app/announcements", "All announcements")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel>
    </Rows>
  );
}
