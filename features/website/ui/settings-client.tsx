"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SOCIALS, type SiteSettings } from "@smw/site-templates";
import { EmptyLine } from "@smw/ui/finance/States";
import { Panel } from "@smw/ui/kit/Panel";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, INPUT, type Field } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { addRedirect, bringBack, removeRedirect, saveSiteSettings, takeOffline } from "./site-actions";

const M = "text-[var(--ds-on-surface-muted)]";
const redirectFields: Field[] = [
  { name: "from", label: "Old address", required: true, placeholder: "/old-page", hint: "Starts with /. Visitors who use it are sent on." },
  { name: "to", label: "Goes to", required: true, placeholder: "/admissions or https://...", hint: "A page of your site or a full https:// link." },
];

/** One block with its own Save: a setting is saved alone, so one mistake never blocks the rest. */
function Block({ title, children, onSave, canManage, hint }: { title: string; children: ReactNode; onSave: () => Promise<{ ok: boolean; error?: string }>; canManage: boolean; hint?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () => start(async () => {
    const r = await onSave();
    if (r.ok) { setError(null); toast("Saved. It is live now."); router.refresh(); } else { setError(r.error ?? "Could not save"); toast(r.error ?? "Could not save", "danger"); }
  });
  return (
    <Panel title={title} className="h-auto">
      {hint ? <p className={cn("-mt-2 mb-3 text-xs", M)}>{hint}</p> : null}
      {children}
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      {canManage ? <div className="mt-4"><Button type="button" size="sm" className="rounded-full" isLoading={pending} onClick={save}>Save</Button></div> : null}
    </Panel>
  );
}
const patch = (p: Record<string, unknown>) => { const fd = new FormData(); fd.set("patch", JSON.stringify(p)); return saveSiteSettings(fd); };
const field = (id: string, label: string, el: ReactNode) => <label htmlFor={id} className="grid gap-1.5 text-sm">{label}{el}</label>;

export function SettingsClient({ settings, canManage, canPublish, teachers, publishers, offlineSince, redirects }: {
  settings: SiteSettings; canManage: boolean; canPublish: boolean; teachers: { id: string; name: string; hidden: boolean }[]; publishers: string[]; offlineSince: string | null;
  redirects: { id: string; from: string; to: string; automatic: boolean }[];
}) {
  const n = settings.notice;
  const [notice, setNotice] = useState({ text: n?.text ?? "", href: n?.href ?? "", tone: n?.tone ?? "info", from: n?.from ?? "", until: n?.until ?? "" });
  const [call, setCall] = useState(settings.callNumber ?? "");
  const [wa, setWa] = useState(settings.whatsapp ?? "");
  const [dir, setDir] = useState(settings.showDirections);
  const [social, setSocial] = useState<Record<string, string>>(Object.fromEntries(SOCIALS.map((s) => [s, settings.social[s] ?? ""])));
  const [indexed, setIndexed] = useState(settings.indexed);
  const [hidden, setHidden] = useState(new Set(teachers.filter((t) => t.hidden).map((t) => t.id)));
  const [offMsg, setOffMsg] = useState(settings.offlineMessage ?? "");
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const off = (fd: FormData) => start(async () => {
    const r = await takeOffline(fd);
    if (r.ok) { toast("The website is offline"); setAsking(false); setTyped(""); router.refresh(); } else toast(r.error, "danger");
  });

  return (
    <div className="grid gap-3 pb-8 xl:grid-cols-2">
      <Block title="Notice bar" canManage={canManage} hint="One line across the top of every page, like an exam date or a holiday. Leave the text empty to remove it."
        onSave={() => patch({ notice: notice.text.trim() ? { text: notice.text, href: notice.href || undefined, tone: notice.tone, from: notice.from || undefined, until: notice.until || undefined } : null })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("n-text", "Text", <input id="n-text" className={INPUT} maxLength={160} value={notice.text} disabled={!canManage} onChange={(e) => setNotice({ ...notice, text: e.target.value })} placeholder="Admissions are open for 2027-28" />)}</div>
          {field("n-href", "Link (optional)", <input id="n-href" className={INPUT} value={notice.href} disabled={!canManage} onChange={(e) => setNotice({ ...notice, href: e.target.value })} placeholder="/admissions" />)}
          {field("n-tone", "Look", <select id="n-tone" className={INPUT} value={notice.tone} disabled={!canManage} onChange={(e) => setNotice({ ...notice, tone: e.target.value as "info" | "important" })}><option value="info">Normal</option><option value="important">Important</option></select>)}
          {field("n-from", "Show from", <input id="n-from" type="date" className={INPUT} value={notice.from} disabled={!canManage} onChange={(e) => setNotice({ ...notice, from: e.target.value })} />)}
          {field("n-until", "Show until", <input id="n-until" type="date" className={INPUT} value={notice.until} disabled={!canManage} onChange={(e) => setNotice({ ...notice, until: e.target.value })} />)}
        </div>
      </Block>

      <Block title="Buttons on phones" canManage={canManage} hint="Round buttons at the bottom of the screen. Most visitors use a phone."
        onSave={() => patch({ callNumber: call.trim() || null, whatsapp: wa.trim() || null, showDirections: dir })}>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("b-call", "Call number", <input id="b-call" inputMode="tel" className={INPUT} value={call} disabled={!canManage} onChange={(e) => setCall(e.target.value)} placeholder="9876543210" />)}
          {field("b-wa", "WhatsApp number", <input id="b-wa" inputMode="tel" className={INPUT} value={wa} disabled={!canManage} onChange={(e) => setWa(e.target.value)} placeholder="9876543210" />)}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={dir} disabled={!canManage} onChange={(e) => setDir(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Show a Directions button (opens the map to your address)</label>
        </div>
      </Block>

      <Block title="Social links" canManage={canManage} hint="Full links starting with https://. Empty ones are not shown."
        onSave={() => patch({ social: Object.fromEntries(Object.entries(social).map(([k, v]) => [k, v.trim() || undefined])) })}>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIALS.map((s) => field(`s-${s}`, s === "x" ? "X" : s[0]!.toUpperCase() + s.slice(1), <input key={s} id={`s-${s}`} className={INPUT} value={social[s]} disabled={!canManage} onChange={(e) => setSocial({ ...social, [s]: e.target.value })} placeholder="https://..." />))}
        </div>
      </Block>

      <Block title="Search engines" canManage={canManage} onSave={() => patch({ indexed })}
        hint="Google and others list your website so parents can find it. Turn this off only while the site is not ready. A page can also be kept out one by one under Pages and menu.">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={indexed} disabled={!canManage} onChange={(e) => setIndexed(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Let search engines list the website</label>
      </Block>

      <Block title="Teachers shown on the website" canManage={canManage} onSave={() => patch({ hiddenStaff: [...hidden] })}
        hint="Names are shown as written in your staff list. Untick anyone who should not be named.">
        {teachers.length === 0 ? <EmptyLine title="No teachers yet." hint="Add staff and they appear here." action={<Link href="/app/staff" className="text-sm text-[var(--ds-primary-text)] hover:underline">Go to staff</Link>} /> : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {teachers.map((t) => (
              <li key={t.id}><label className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm hover:bg-white/[0.05]">
                <input type="checkbox" checked={!hidden.has(t.id)} disabled={!canManage} onChange={(e) => setHidden((h) => { const x = new Set(h); if (e.target.checked) x.delete(t.id); else x.add(t.id); return x; })} className="h-4 w-4 accent-[var(--ds-primary)]" />{t.name}</label></li>
            ))}
          </ul>
        )}
      </Block>

      <Panel title="Who may publish" className="h-auto">
        <p className={cn("-mt-2 mb-3 text-xs", M)}>Anyone with the website editing right can change the draft. Only these people can publish. Everyone else asks.</p>
        <ul className="mb-3 flex flex-wrap gap-2">{publishers.map((p) => <li key={p}><ToneBadge label={p} /></li>)}</ul>
        <Link href="/app/settings/roles" className="text-sm text-[var(--ds-primary-text)] hover:underline">Give a role the right to publish</Link>
      </Panel>

      <Panel title="Redirects" className="h-auto xl:col-span-2"
        action={canManage ? <FormModal title="Add a redirect" description="Send an old address to a page you want visitors to see." icon="web" fields={redirectFields} action={addRedirect} submitLabel="Add redirect" trigger={{ label: "Add redirect", variant: "secondary", size: "sm", plus: true }} /> : null}>
        <p className={cn("-mt-2 mb-3 text-xs", M)}>When you change a page's address a redirect is made for you and stays. Add your own for old printed links and QR codes.</p>
        {redirects.length === 0 ? <EmptyLine title="No redirects." hint="They appear when you change a page address, or add one yourself." /> : (
          <ul className="flex flex-col gap-1">
            {redirects.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.035] py-1 pl-4 pr-2 text-sm">
                <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs">{r.from}</span> <span className={M}>leads to</span> <span className="font-mono text-xs">{r.to}</span></span>
                {r.automatic ? <ToneBadge label="Made by an address change" /> : null}
                {canManage ? <ActionButton variant="icon-delete" label={`Remove redirect from ${r.from}`} action={removeRedirect} values={{ id: r.id }} successMessage="Redirect removed"
                  confirm={{ title: `Remove the redirect from ${r.from}?`, body: "Visitors and links that still use this address will see a page not found.", confirmLabel: "Remove", danger: true }} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Block title="Website is being updated" canManage={canManage} onSave={() => patch({ offlineMessage: offMsg.trim() || null })}
        hint="What visitors read while the website is offline.">
        {field("o-msg", "Message", <textarea id="o-msg" rows={2} maxLength={300} className={cn(INPUT, "h-auto py-2")} value={offMsg} disabled={!canManage} onChange={(e) => setOffMsg(e.target.value)} placeholder="We are updating our website. Please call the school office." />)}
      </Block>

      <Panel title={offlineSince ? "The website is offline" : "Take the website offline"} className="h-auto">
        {offlineSince ? (
          <>
            <p className="mb-3 text-sm">Visitors have seen &quot;the website is being updated&quot; since {offlineSince}. Your pages, versions and draft are untouched.</p>
            {canPublish ? <ActionButton variant="default" label="Bring the website back" action={bringBack} successMessage="The website is back" /> : <p className={cn("text-sm", M)}>Someone who may publish can bring it back.</p>}
          </>
        ) : (
          <>
            <p className={cn("mb-3 text-sm", M)}>Visitors see a short &quot;being updated&quot; page instead of your pages. Use it for a big change or a mistake you must hide at once. Nothing is deleted.</p>
            {canPublish ? <Button type="button" variant="secondary" className="rounded-full" onClick={() => setAsking(true)}>Take offline</Button> : <p className={cn("text-sm", M)}>Only people who may publish can take it offline.</p>}
          </>
        )}
      </Panel>

      <Modal open={asking} onOpenChange={setAsking} size="sm" tone="danger" title="Take the website offline?" description="Visitors cannot open any page until you bring it back. Parents who search for the school will see the updating message."
        footer={<ModalFooter danger secondary={{ onClick: () => setAsking(false) }} primary={{ label: "Take offline", loading: pending, disabled: typed.trim().toUpperCase() !== "OFFLINE", onClick: () => { const fd = new FormData(); fd.set("confirm", typed); off(fd); } }} />}>
        <ModalField label="Type OFFLINE to confirm" htmlFor="off-type"><input id="off-type" className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></ModalField>
      </Modal>
    </div>
  );
}
