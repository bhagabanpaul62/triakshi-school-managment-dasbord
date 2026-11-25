"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconArrowDown, IconArrowDownRight, IconArrowUp, IconArrowUpLeft, IconPlus, IconTrash } from "@tabler/icons-react";
import { dateTime } from "@smw/ui/format";
import { HOME_SLUG, MENU_TOP_MAX, type Page, type SiteContent } from "@smw/site-templates";
import { EmptyLine } from "@smw/ui/finance/States";
import { Panel } from "@smw/ui/kit/Panel";
import { FormModal, INPUT, type Field } from "@smw/ui/shell/FormModal";
import { MenuItem, MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { addPage, updatePage } from "./actions";
import { addPageFields, pageFields } from "./page-fields";
import { navOp, pageOp, saveFooter } from "./site-actions";
import { UndoNotice, type UndoState } from "./undo-notice";

export interface PageRow { lastBy: string; lastAt: string; slug: string; title: string; intro: string; state: "live" | "changed" | "draft_only" | "hidden"; sections: number; noindex: boolean; hidden: boolean; inMenu: boolean; seoTitle: string; seoDescription: string; seoImageUrl: string }
const M = "text-[var(--ds-on-surface-muted)]";
const STATE = { live: ["Live", "success"], changed: ["Changed", "warning"], draft_only: ["Draft only", "default"], hidden: ["Hidden", "default"] } as const;
const ICON = "inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-full hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-30";

const renameFields: Field[] = [{ name: "to", label: "New web address", required: true, hint: "Lowercase letters, numbers and dashes. People who use the old address are sent to the new one for ever, and your menu and links follow." }];
const labelField: Field[] = [{ name: "label", label: "Name in the menu", required: true, hint: "30 characters at most." }];
const linkFields: Field[] = [
  { name: "label", label: "Name in the menu", required: true },
  { name: "href", label: "Link", required: true, placeholder: "https://... or /page", hint: "A page of another website, or a page address of yours." },
];

export function PagesClient({ pages, nav, footer, limit, canManage, host }: { pages: PageRow[]; nav: SiteContent["nav"]; footer: SiteContent["footer"]; limit: number | null; canManage: boolean; host: string }) {
  const router = useRouter();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [pending, start] = useTransition();
  const full = limit != null && pages.length >= limit;
  const byTitle = new Map(pages.map((p) => [p.slug, p.title]));

  const run = useCallback((action: (fd: FormData) => Promise<{ ok: boolean; error?: string; data?: unknown }>, values: Record<string, string>, done?: (d: unknown) => void) => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { done?.(r.data); router.refresh(); } else toast(r.error ?? "Something went wrong.", "danger");
  }), [router]);

  const remove = (p: PageRow) => run(pageOp, { op: "remove", slug: p.slug }, (d) => {
    const removed = (d as { removed: Page | null }).removed;
    if (!removed) return;
    setUndo({ text: `"${p.title}" deleted.`, until: Date.now() + 30_000, run: async () => {
      const fd = new FormData(); fd.set("op", "restore"); fd.set("page", JSON.stringify(removed));
      const r = await pageOp(fd);
      if (r.ok) router.refresh(); else toast(r.error, "danger");
    } });
  });

  const notInMenu = pages.filter((p) => !p.inMenu && !p.hidden);
  const topFull = nav.length >= MENU_TOP_MAX;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <Panel title={`Pages (${pages.length}${limit ? ` of ${limit}` : ""})`} className="h-auto"
        action={canManage ? (full ? <span className={cn("text-xs", M)}>Your plan allows {limit} pages. <Link href="/app/billing" className="text-[var(--ds-primary-text)] hover:underline">See plans</Link></span>
          : <FormModal title="Add page" description="Start from a ready-made page, then change anything." icon="web" fields={addPageFields} action={addPage} submitLabel="Add page" trigger={{ label: "Add page", variant: "secondary", size: "sm", plus: true }} />) : null}>
        {pages.length === 0 ? <EmptyLine title="No pages yet." hint="Add the first one." /> : (
          <ul className="flex flex-col gap-2">
            {pages.map((p) => {
              const [label, tone] = STATE[p.state];
              return (
                <li key={p.slug} className="rounded-2xl bg-white/[0.035] p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/app/website/edit?page=${p.slug}`} className="text-sm font-medium hover:underline">{p.title}</Link>
                        <ToneBadge label={label} tone={tone} />
                        {p.noindex ? <ToneBadge label="Not in search" tone="default" /> : null}
                        {!p.inMenu && !p.hidden ? <span className={cn("text-xs", M)}>Not in the menu</span> : null}
                      </div>
                      <p className={cn("mt-0.5 text-xs", M)}>/{p.slug === HOME_SLUG ? "" : p.slug} · {p.sections} section{p.sections === 1 ? "" : "s"} · {p.lastAt ? `Last change ${dateTime(p.lastAt)}${p.lastBy ? ` by ${p.lastBy}` : ""}` : "No change noted yet"}</p>
                      <div className="mt-2 max-w-xl rounded-xl bg-white/[0.04] px-3 py-2" aria-label="How it looks in search results">
                        <p className="truncate text-sm text-[var(--ds-primary-text)]">{p.seoTitle || p.title}</p>
                        <p className={cn("truncate text-[11px]", M)}>{host}{p.slug === HOME_SLUG ? "" : `/${p.slug}`}</p>
                        <p className={cn("line-clamp-2 text-xs", p.seoDescription ? "" : M)}>{p.seoDescription || "No description. Search engines will pick words from the page."}</p>
                      </div>
                    </div>
                    {canManage ? (
                      <MoreMenu iconOnly label={`More for ${p.title}`}>
                        <MenuLink href={`/app/website/edit?page=${p.slug}`}>Edit sections</MenuLink>
                        <FormModal title="Page settings" icon="web" fields={pageFields} action={updatePage} hidden={{ slug: p.slug }} values={{ title: p.title, intro: p.intro, seoTitle: p.seoTitle, seoDescription: p.seoDescription, seoImageUrl: p.seoImageUrl }} trigger={{ label: "Search and share words", variant: "ghost" }} />
                        {p.slug !== HOME_SLUG ? <FormModal title="Change web address" icon="web" fields={renameFields} action={pageOp} hidden={{ op: "rename", slug: p.slug }} values={{ to: p.slug }} submitLabel="Change address" successMessage="Address changed. The old one leads here" trigger={{ label: "Change address", variant: "ghost" }} /> : null}
                        {!full ? <MenuItem onClick={() => run(pageOp, { op: "duplicate", slug: p.slug })}>Duplicate</MenuItem> : null}
                        {p.slug !== HOME_SLUG ? <MenuItem onClick={() => run(pageOp, { op: p.hidden ? "show" : "hide", slug: p.slug })}>{p.hidden ? "Show on the site" : "Hide from the site"}</MenuItem> : null}
                        <MenuItem onClick={() => run(pageOp, { op: p.noindex ? "index" : "noindex", slug: p.slug })}>{p.noindex ? "Let search engines list it" : "Keep out of search"}</MenuItem>
                        {p.slug !== HOME_SLUG ? <MenuItem tone="danger" onClick={() => remove(p)}>Delete</MenuItem> : null}
                      </MoreMenu>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="flex flex-col gap-3">
        <Panel title={`Menu (${nav.length} of ${MENU_TOP_MAX} at the top)`} className="h-auto"
          action={canManage ? (
            <MoreMenu label="Add to the menu" icon={<IconPlus className="h-4 w-4" aria-hidden />}>
              {notInMenu.map((p) => <MenuItem key={p.slug} disabled={topFull} onClick={() => run(navOp, { op: "add", label: p.title.slice(0, 30), slug: p.slug })}>{p.title}</MenuItem>)}
              <FormModal title="Add a link" icon="web" fields={linkFields} action={navOp} hidden={{ op: "add" }} trigger={{ label: "A link to another site", variant: "ghost" }} />
            </MoreMenu>
          ) : null}>
          {topFull ? <p className={cn("mb-3 text-xs", M)}>The menu is full. Put an entry under another or remove one to add more.</p> : null}
          {nav.length === 0 ? <EmptyLine title="The menu is empty." hint="Visitors then have no way to move between pages. Add your pages." /> : (
            <ol className="flex flex-col gap-1">
              {nav.map((n, i) => (
                <li key={`${n.label}-${i}`}>
                  <MenuRow path={`${i}`} label={n.label} target={n.slug ? byTitle.get(n.slug) ?? n.slug : n.href ?? "Groups the entries below"} canManage={canManage} first={i === 0} last={i === nav.length - 1} pending={pending} run={run}
                    nest={i > 0 && !n.children?.length && (nav[i - 1]!.children?.length ?? 0) < 8} />
                  {n.children?.length ? (
                    <ol className="ml-6 mt-1 flex flex-col gap-1 border-l border-white/[0.08] pl-3">
                      {n.children.map((c, j) => (
                        <li key={`${c.label}-${j}`}>
                          <MenuRow path={`${i}.${j}`} label={c.label} target={c.slug ? byTitle.get(c.slug) ?? c.slug : c.href ?? ""} canManage={canManage} first={j === 0} last={j === n.children!.length - 1} pending={pending} run={run} unnest={!topFull} />
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          <p className={cn("mt-3 text-xs", M)}>A page that is hidden is not shown in the menu even when it is listed here.</p>
        </Panel>

        <FooterPanel footer={footer} canManage={canManage} />
      </div>
      <UndoNotice undo={undo} onDone={() => setUndo(null)} />
    </div>
  );
}

function MenuRow({ path, label, target, canManage, first, last, pending, run, nest, unnest }: {
  path: string; label: string; target: string; canManage: boolean; first: boolean; last: boolean; pending: boolean; nest?: boolean; unnest?: boolean;
  run: (a: (fd: FormData) => Promise<{ ok: boolean; error?: string; data?: unknown }>, v: Record<string, string>) => void;
}) {
  const go = (o: string) => run(navOp, { op: o, path });
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/[0.035] py-1 pl-3 pr-1">
      <div className="min-w-0 flex-1"><p className="truncate text-sm">{label}</p><p className={cn("truncate text-[11px]", M)}>{target}</p></div>
      {canManage ? (
        <>
          <button type="button" aria-label={`Move ${label} up`} disabled={first || pending} onClick={() => go("up")} className={ICON}><IconArrowUp className="h-4 w-4" aria-hidden /></button>
          <button type="button" aria-label={`Move ${label} down`} disabled={last || pending} onClick={() => go("down")} className={ICON}><IconArrowDown className="h-4 w-4" aria-hidden /></button>
          {nest ? <button type="button" aria-label={`Put ${label} under the entry above`} title="Put under the entry above" disabled={pending} onClick={() => go("nest")} className={ICON}><IconArrowDownRight className="h-4 w-4" aria-hidden /></button> : null}
          {unnest ? <button type="button" aria-label={`Move ${label} to the top level`} title="Move to the top level" disabled={pending} onClick={() => go("unnest")} className={ICON}><IconArrowUpLeft className="h-4 w-4" aria-hidden /></button> : null}
          <MoreMenu iconOnly label={`More for ${label}`}>
            <FormModal title="Rename menu entry" icon="web" fields={labelField} action={navOp} hidden={{ op: "rename", path }} values={{ label }} trigger={{ label: "Rename", variant: "ghost" }} />
            <MenuItem tone="danger" onClick={() => go("remove")}>Remove from the menu</MenuItem>
          </MoreMenu>
        </>
      ) : null}
    </div>
  );
}

/** Footer words and up to eight links, saved in one go. */
function FooterPanel({ footer, canManage }: { footer: SiteContent["footer"]; canManage: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(footer.text ?? "");
  const [links, setLinks] = useState(footer.links);
  const [cols, setCols] = useState(footer.columns ?? []);
  const [pending, start] = useTransition();
  const dirty = text !== (footer.text ?? "") || JSON.stringify(links) !== JSON.stringify(footer.links) || JSON.stringify(cols) !== JSON.stringify(footer.columns ?? []);
  const save = () => start(async () => {
    const fd = new FormData();
    const keep = (ls: typeof links) => ls.filter((l) => l.label.trim() || l.href.trim());
    fd.set("text", text); fd.set("links", JSON.stringify(keep(links)));
    fd.set("columns", JSON.stringify(cols.filter((c) => c.title.trim() || keep(c.links).length).map((c) => ({ title: c.title, links: keep(c.links) }))));
    const r = await saveFooter(fd);
    if (r.ok) { toast("Footer saved to the draft."); router.refresh(); } else toast(r.error, "danger");
  });
  return (
    <Panel title="Footer" className="h-auto">
      <label className="grid gap-1.5 text-sm">Footer text
        <input className={INPUT} value={text} maxLength={300} disabled={!canManage} onChange={(e) => setText(e.target.value)} placeholder="Affiliated to CBSE. Affiliation No. ..." /></label>
      <p className={cn("mb-2 mt-4 text-sm")}>Links ({links.length} of 8)</p>
      <ul className="flex flex-col gap-2">
        {links.map((l, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <input aria-label={`Link ${i + 1} name`} className={cn(INPUT, "h-9 text-xs")} value={l.label} disabled={!canManage} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Privacy" />
            <input aria-label={`Link ${i + 1} address`} className={cn(INPUT, "h-9 text-xs")} value={l.href} disabled={!canManage} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} placeholder="/privacy or https://..." />
            {canManage ? <button type="button" aria-label={`Remove link ${i + 1}`} className={ICON} onClick={() => setLinks(links.filter((_, j) => j !== i))}><IconTrash className="h-4 w-4" aria-hidden /></button> : <span />}
          </li>
        ))}
      </ul>
      <p className="mb-2 mt-5 text-sm">Link columns ({cols.length} of 4)</p>
      <ul className="flex flex-col gap-3">
        {cols.map((col, ci) => (
          <li key={ci} className="rounded-2xl bg-white/[0.035] p-3">
            <div className="mb-2 flex items-center gap-2">
              <input aria-label={`Column ${ci + 1} title`} className={cn(INPUT, "h-9 text-xs")} value={col.title} maxLength={30} disabled={!canManage} placeholder="Admissions" onChange={(e) => setCols(cols.map((x, j) => (j === ci ? { ...x, title: e.target.value } : x)))} />
              {canManage ? <button type="button" aria-label={`Remove column ${ci + 1}`} className={ICON} onClick={() => setCols(cols.filter((_, j) => j !== ci))}><IconTrash className="h-4 w-4" aria-hidden /></button> : null}
            </div>
            <ul className="flex flex-col gap-2">
              {col.links.map((l, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <input aria-label={`Column ${ci + 1} link ${i + 1} name`} className={cn(INPUT, "h-9 text-xs")} value={l.label} disabled={!canManage} placeholder="Fees" onChange={(e) => setCols(cols.map((x, j) => (j === ci ? { ...x, links: x.links.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)) } : x)))} />
                  <input aria-label={`Column ${ci + 1} link ${i + 1} address`} className={cn(INPUT, "h-9 text-xs")} value={l.href} disabled={!canManage} placeholder="/fees or https://..." onChange={(e) => setCols(cols.map((x, j) => (j === ci ? { ...x, links: x.links.map((y, k) => (k === i ? { ...y, href: e.target.value } : y)) } : x)))} />
                  {canManage ? <button type="button" aria-label={`Remove link ${i + 1} of column ${ci + 1}`} className={ICON} onClick={() => setCols(cols.map((x, j) => (j === ci ? { ...x, links: x.links.filter((_, k) => k !== i) } : x)))}><IconTrash className="h-4 w-4" aria-hidden /></button> : <span />}
                </li>
              ))}
            </ul>
            {canManage ? <Button type="button" size="sm" variant="ghost" className="mt-2 rounded-full" disabled={col.links.length >= 8} onClick={() => setCols(cols.map((x, j) => (j === ci ? { ...x, links: [...x.links, { label: "", href: "" }] } : x)))}><IconPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Add link</Button> : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={cols.length >= 4} onClick={() => setCols([...cols, { title: "", links: [{ label: "", href: "" }] }])}><IconPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Add column</Button>
          <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={links.length >= 8} onClick={() => setLinks([...links, { label: "", href: "" }])}><IconPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Add link</Button>
          <Button type="button" size="sm" className="rounded-full" isLoading={pending} disabled={!dirty} onClick={save}>Save footer</Button>
        </div>
      ) : null}
    </Panel>
  );
}
