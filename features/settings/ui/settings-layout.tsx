import type { ReactNode } from "react";
import { requireCtx } from "@smw/runtime";
import { settingsNav } from "./nav";
import { BackToSettings, SettingsNav } from "./settings-nav";

/** The frame of every Settings page: side list on a desktop, the list as the home page on a phone. It never blocks: each page checks its own permission. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const groups = settingsNav(await requireCtx());
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <SettingsNav groups={groups} />
      <div className="order-first min-w-0 flex-1 lg:order-none">
        <BackToSettings />
        {children}
      </div>
    </div>
  );
}
