"use client";

import { useRouter } from "next/navigation";
import { TabBar, type TabItem } from "@smw/ui/kit/TabBar";

/** Tabs whose state lives in `?tab=`, so each tab is a link a person can share and the server renders only that tab. */
export function UrlTabs({ tabs, value, label }: { tabs: TabItem<string>[]; value: string; label: string }) {
  const router = useRouter();
  return <TabBar tabs={tabs} value={value} label={label} onChange={(tab) => router.push(`?tab=${tab}`)} />;
}
