import { allows, type Ctx } from "@smw/feature-kit";
import type { ShellNavGroup } from "@smw/ui/shell/AppShell";
import { FEATURES } from "@/generated/features";

const GROUPS = [
  ["main", "Overview"], ["academics", "Academics"], ["people", "People"], ["finance", "Finance"],
  ["communication", "Communication"], ["website", "Website"], ["admin", "School"],
] as const;

/** Sidebar from every feature's menu, filtered by the modules this school has and the role's permissions. */
export function buildMenu(ctx: Ctx, badges: Record<string, number> = {}): ShellNavGroup[] {
  const items = FEATURES.filter((f) => ctx.features.has(f.key)).flatMap((f) =>
    (f.menu ?? []).filter((m) => allows(ctx, f, m.permission)).map((m) => ({ ...m, group: m.group ?? "main" })),
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
