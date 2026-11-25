"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { disclosureTitle } from "@smw/site-templates";
import { cn } from "@smw/ui/utils";

const TABS = [
  { href: "/app/website", label: "Overview" },
  { href: "/app/website/edit", label: "Edit" },
  { href: "/app/website/pages", label: "Pages and menu" },
  { href: "/app/website/media", label: "Media" },
  { href: "/app/website/disclosure", label: "Disclosure" },
  { href: "/app/website/versions", label: "Versions" },
  { href: "/app/website/insights", label: "Insights" },
  { href: "/app/website/settings", label: "Settings" },
] as const;

/** The one tab bar of the Website area. It scrolls sideways on a phone. */
export function WebsiteTabs({ board }: { board?: string | null }) {
  const info = disclosureTitle(board) === "School information";
  const path = usePathname();
  return (
    <nav aria-label="Website" className="-mx-1 mb-4 relative overflow-x-auto px-1">
      <ul className="inline-flex min-w-full items-center gap-1 rounded-full bg-white/[0.05] p-1 sm:min-w-0">
        {TABS.map((t) => {
          const on = t.href === "/app/website" ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={on ? "page" : undefined}
                className={cn("flex min-h-9 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]",
                  on ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>{t.href.endsWith("/disclosure") && info ? "School information" : t.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
