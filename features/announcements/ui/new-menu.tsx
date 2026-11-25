"use client";

import { IconPlus } from "@tabler/icons-react";
import { MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";

/** "New notice": a notice, a circular, an urgent alert (only for those who may send one), or a start from a template. */
export function NewMenu({ urgent, templates }: { urgent: boolean; templates: { id: string; name: string }[] }) {
  return (
    <MoreMenu primary label="New notice" icon={<IconPlus className="h-4 w-4" aria-hidden />}>
      <MenuLink href="/app/announcements/new">Notice</MenuLink>
      <MenuLink href="/app/announcements/new?type=circular">Circular with a number</MenuLink>
      {urgent ? <MenuLink href="/app/announcements/new?type=urgent" tone="danger">Urgent alert</MenuLink> : null}
      {templates.length ? <p className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">From a template</p> : null}
      {templates.map((t) => <MenuLink key={t.id} href={`/app/announcements/new?template=${t.id}`}><span className="truncate">{t.name}</span></MenuLink>)}
    </MoreMenu>
  );
}
