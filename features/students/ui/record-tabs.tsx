"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TabBar, type TabItem } from "@smw/ui/kit/TabBar";

/** The record page's tab bar: the active tab lives in `?tab=` so it can be linked and survives a refresh. */
export function RecordTabs({ tabs, value, panelId }: { tabs: TabItem<string>[]; value: string; panelId: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const go = (tab: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", tab);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };
  return <TabBar tabs={tabs} value={value} onChange={go} label="Student record" panelId={panelId} />;
}
