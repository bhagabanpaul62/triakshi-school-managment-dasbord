"use client";

import { usePathname, useRouter } from "next/navigation";
import { TabBar, type TabItem } from "@smw/ui/kit/TabBar";

/** Record-page tabs kept in the URL (`?tab=`), so the server page renders the right panel. */
export function StaffTabs({ tabs, value }: { tabs: TabItem<string>[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  return <TabBar tabs={tabs} value={value} label="Staff record sections" panelId="staff-panel" onChange={(id) => router.replace(`${path}?tab=${id}`, { scroll: false })} />;
}
