import Link from "next/link";

export type NavItem = { href: string; label: string };

/** Links between the attendance pages, shown in the page header. */
export function AttendanceNav({ items, active }: { items: NavItem[]; active: string }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Attendance pages" className="flex gap-1 rounded-full bg-white/[0.05] p-1">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.href === active ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors duration-150 ${i.href === active ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
