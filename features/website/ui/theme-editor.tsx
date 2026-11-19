"use client";
/* eslint-disable @next/next/no-img-element -- the logo is an arbitrary https link, so next/image cannot optimise it */

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { checkContrast, FONTS, RADII, type Theme } from "@smw/themes";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";

const COLORS: { key: keyof Theme["colors"]; label: string; primary?: boolean }[] = [
  { key: "primary", label: "Primary", primary: true }, { key: "primaryLight", label: "Primary tint" },
  { key: "secondary", label: "Secondary" }, { key: "secondaryLight", label: "Secondary tint" },
  { key: "accent", label: "Accent" }, { key: "accentLight", label: "Accent tint" },
  { key: "background", label: "Page background" }, { key: "surface", label: "Cards and bands" },
  { key: "text", label: "Text" }, { key: "mutedText", label: "Muted text" },
];

/** Theme editor: presets, colours, radius, font, logo, a live mini preview and inline contrast problems. */
export function ThemeEditor({ initial, presets, limited, schoolName, action }: {
  initial: Theme; presets: Theme[]; limited: boolean; schoolName: string; action: (fd: FormData) => Promise<FormResult>;
}) {
  const [t, setT] = useState<Theme>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const issues = useMemo(() => checkContrast(t), [t]);
  const changed = useMemo(() => JSON.stringify(t) !== JSON.stringify(initial), [t, initial]);
  const setColor = (k: keyof Theme["colors"], v: string) => setT((p) => ({ ...p, colors: { ...p.colors, [k]: v } }));

  const submit = (fd: FormData) => start(async () => {
    const r = await action(fd);
    if (r.ok) { setErrors({}); toast(r.message ?? "Theme saved"); router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });

  const c = t.colors;
  const vars = { "--p": c.primary, "--pl": c.primaryLight, "--s": c.secondary, "--a": c.accent, "--bg": c.background, "--sf": c.surface, "--tx": c.text, "--mt": c.mutedText, "--r": RADII[t.radius] } as CSSProperties;

  return (
    <form action={submit} className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* locked fields still travel with the form, so the saved theme stays whole */}
      <input type="hidden" name="preset" value={t.preset} />
      {limited ? <>
        <input type="hidden" name="radius" value={t.radius} /><input type="hidden" name="font" value={t.font} />
        {COLORS.filter((x) => !x.primary).map((x) => <input key={x.key} type="hidden" name={x.key} value={c[x.key]} />)}
        <input type="hidden" name="faviconUrl" value={t.faviconUrl ?? ""} />
      </> : null}

      <div className="flex flex-col gap-3 lg:col-span-7">
        {limited ? <p role="note" className="rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">Your plan lets you change the logo and the primary colour. Upgrade to edit every colour, the font and the corner style.</p> : null}

        <Panel title="Starting point">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.preset} type="button" disabled={limited} onClick={() => setT({ ...p, logoUrl: t.logoUrl, faviconUrl: t.faviconUrl })} aria-pressed={t.preset === p.preset}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/[0.05] px-4 text-sm capitalize transition-colors hover:bg-white/[0.09] disabled:opacity-50 aria-pressed:bg-white/[0.12]">
                <span className="h-4 w-4 rounded-full" style={{ background: p.colors.primary }} aria-hidden />{p.preset}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Colours">
          <div className="grid gap-4 sm:grid-cols-2">
            {COLORS.map((x) => {
              const locked = limited && !x.primary;
              return (
                <label key={x.key} className="flex items-center gap-3 text-sm">
                  <input type="color" name={locked ? undefined : x.key} value={c[x.key].toLowerCase()} disabled={locked} aria-label={x.label}
                    onChange={(e) => setColor(x.key, e.target.value.toUpperCase())} className="h-10 w-12 shrink-0 cursor-pointer rounded-xl bg-white/[0.05] p-1 disabled:opacity-40" />
                  <span className="min-w-0"><span className="block">{x.label}</span><span className="block font-mono text-xs text-[var(--ds-on-surface-muted)]">{c[x.key].toUpperCase()}</span>
                    {errors[x.key] ? <span className="block text-xs text-[var(--ds-color-danger-400)]">{errors[x.key]}</span> : null}</span>
                </label>
              );
            })}
          </div>
          {issues.length ? (
            <ul role="alert" className="mt-5 flex flex-col gap-2 rounded-2xl bg-white/[0.035] p-4 text-sm">
              {issues.map((i) => <li key={i.pair} className="flex items-start gap-2"><ToneBadge label="Hard to read" tone="danger" /><span>{i.pair} is {i.ratio}:1, it needs at least {i.min}:1. Make one of the two darker or lighter.</span></li>)}
            </ul>
          ) : <p className="mt-5 flex items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]"><ToneBadge label="Readable" tone="success" />Every colour pair passes the contrast check.</p>}
        </Panel>

        <Panel title="Style and logo">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">Corners
              <select name={limited ? undefined : "radius"} value={t.radius} disabled={limited} onChange={(e) => setT({ ...t, radius: e.target.value as Theme["radius"] })} className={INPUT}>
                <option value="none">Square</option><option value="sm">Slightly rounded</option><option value="md">Rounded</option><option value="lg">Very rounded</option>
              </select></label>
            <label className="grid gap-1.5 text-sm">Font
              <select name={limited ? undefined : "font"} value={t.font} disabled={limited} onChange={(e) => setT({ ...t, font: e.target.value as Theme["font"] })} className={INPUT}>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select></label>
            <label className="grid gap-1.5 text-sm sm:col-span-2">Logo link
              <input name="logoUrl" type="url" inputMode="url" value={t.logoUrl ?? ""} placeholder="https://..." onChange={(e) => setT({ ...t, logoUrl: e.target.value || null })} aria-invalid={errors.logoUrl ? true : undefined} className={INPUT} />
              <span className="text-xs text-[var(--ds-on-surface-muted)]">{errors.logoUrl ?? "A link to your logo image. It shows in the panel and on the website."}</span></label>
            {!limited ? <label className="grid gap-1.5 text-sm sm:col-span-2">Browser icon link
              <input name="faviconUrl" type="url" inputMode="url" value={t.faviconUrl ?? ""} placeholder="https://..." onChange={(e) => setT({ ...t, faviconUrl: e.target.value || null })} className={INPUT} /></label> : null}
          </div>
        </Panel>
      </div>

      <div className="lg:col-span-5">
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <Panel title="Live preview">
            <div style={{ ...vars, background: "var(--bg)", color: "var(--tx)", borderRadius: "calc(var(--r) + 8px)", overflow: "hidden", fontFamily: `'${t.font}', system-ui, sans-serif` }} aria-label="Preview of your website">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--bg)" }}>
                {t.logoUrl ? <img src={t.logoUrl} alt="" style={{ height: 28, width: "auto" }} /> : null}
                <b style={{ fontSize: 14 }}>{schoolName}</b>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--mt)" }}>About · Admissions</span>
              </div>
              <div style={{ background: "var(--pl)", padding: "28px 20px" }}>
                <h3 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>Where every child grows</h3>
                <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--mt)" }}>A caring school with small classes and big ideas.</p>
                <span style={{ display: "inline-block", background: "var(--p)", color: "#fff", padding: "9px 18px", borderRadius: "calc(var(--r) + 6px)", fontSize: 13, fontWeight: 600 }}>Apply now</span>
              </div>
              <div style={{ background: "var(--sf)", padding: "14px 20px", display: "flex", gap: 12 }}>
                {["Students", "Teachers"].map((l, i) => (
                  <div key={l} style={{ flex: 1, background: "var(--bg)", borderRadius: "var(--r)", padding: 12 }}>
                    <b style={{ display: "block", fontSize: 20, color: i ? "var(--s)" : "var(--p)" }}>{i ? "60" : "1,200"}</b><span style={{ fontSize: 12, color: "var(--mt)" }}>{l}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 20px 14px", fontSize: 12 }}><span style={{ background: "var(--a)", color: "#111", padding: "2px 8px", borderRadius: 999 }}>New</span> Annual Day on 20 December</div>
            </div>
          </Panel>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-xs text-[var(--ds-on-surface-muted)]">
              {issues.length ? "Fix the colours marked hard to read to save." : changed ? "Unsaved changes. The live site updates when you save." : <a href="/" target="_blank" rel="noopener" className="text-[var(--ds-primary)] hover:underline">See it on your website</a>}
            </span>
            {changed ? <Button type="button" variant="ghost" className="rounded-full" onClick={() => setT(initial)}>Undo changes</Button> : null}
            <Button type="submit" className="rounded-full" isLoading={pending} disabled={issues.length > 0 || !changed}>Save theme</Button>
          </div>
        </div>
      </div>
    </form>
  );
}
