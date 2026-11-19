"use client";

import { usePathname, useRouter } from "next/navigation";
import { TabBar, type TabItem } from "@smw/ui/kit/TabBar";

/** Page tabs kept in the URL (`?tab=`), so the server page renders the right panel. */
export function UrlTabs({ tabs, value, label, panelId }: { tabs: TabItem<string>[]; value: string; label: string; panelId: string }) {
  const router = useRouter();
  const path = usePathname();
  return <TabBar tabs={tabs} value={value} label={label} panelId={panelId} onChange={(id) => router.replace(`${path}?tab=${id}`, { scroll: false })} />;
}
