import { cache } from "react";
import { allows, type Ctx } from "@smw/feature-kit";
import { setupBadges } from "@smw/feature-setup/badge";
import type { ShellNavGroup } from "@smw/ui/shell/AppShell";
import { FEATURES } from "@/generated/features";

const GROUPS = [
  ["main", "Overview"], ["academics", "Academics"], ["people", "People"], ["finance", "Finance"],
  ["communication", "Communication"], ["website", "Website"], ["admin", "School"],
] as const;

const GETTING_STARTED = "/app/getting-started";
const MY_TASKS = "/app/getting-started?mine=1";

/**
 * The setup entries' numbers: tasks left for an admin, tasks given to me for anyone else (0 hides the entry).
 * One cached count per request, kept a minute, never later than a second; a failure counts as 0 and never breaks the menu.
 */
export const getMenuBadges = cache(async (ctx: Ctx): Promise<Record<string, number>> => {
  const b = await setupBadges(ctx).catch(() => ({ left: 0, mine: 0 }));
  return { ...(b.left > 0 ? { [GETTING_STARTED]: b.left } : {}), ...(b.mine > 0 ? { [MY_TASKS]: b.mine } : {}) };
});

/**
 * Sidebar from every feature's menu, filtered by the modules this school has and the role's permissions.
 * The two setup entries show only while `badges` has a number for them (see getMenuBadges).
 */
export function buildMenu(ctx: Ctx, badges: Record<string, number> = {}): ShellNavGroup[] {
  const items = FEATURES.filter((f) => ctx.features.has(f.key)).flatMap((f) =>
    (f.menu ?? []).filter((m) => (allows(ctx, f, m.permission) || (m.also ?? []).some((x) => allows(ctx, f, x))) && (![GETTING_STARTED, MY_TASKS].includes(m.href) || (badges[m.href] ?? 0) > 0)).map((m) => ({ ...m, group: m.group ?? "main" })),
  );
  const home = { label: "Home", href: "/app", icon: "home", group: "main", order: 0 };
  return GROUPS.map(([key, label]) => ({
    label,
    items: [...(key === "main" ? [home] : []), ...items.filter((i) => i.group === key)]
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map(({ label, href, icon }) => ({ label, href, icon, badge: badges[href] || undefined })),
  }));
}

export const ROLE_LABEL: Record<Ctx["role"], string> = { admin: "Administrator", accountant: "Accountant", teacher: "Teacher", student: "Student", parent: "Parent", staff: "Staff" };
