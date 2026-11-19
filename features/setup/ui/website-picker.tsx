"use client";

import { useState } from "react";
import { toast } from "@smw/ui/shell/toast";
import { publishWebsite } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

export interface TemplateOption { key: string; name: string; description: string }
export interface PresetOption { key: string; label: string; primary: string; secondary: string; accent: string }

const card = (on: boolean) =>
  `rounded-2xl p-4 text-left transition-[background-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${on ? "bg-white/[0.12]" : "bg-white/[0.04] hover:bg-white/[0.08]"}`;

/** Three templates, four colour themes (shown by their real colours), one button to publish. */
export function WebsitePicker({ templates, presets, template: t0, preset: p0, publishedAt, next, back, skip }: {
  templates: TemplateOption[]; presets: PresetOption[]; template: string; preset: string; publishedAt: string | null; next: string; back: string | null; skip: string;
}) {
  const [template, setTemplate] = useState(t0);
  const [preset, setPreset] = useState(p0);
  const { pending, run } = useStepRun(next);
  return (
    <div>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Template</h2>
      <div role="radiogroup" aria-label="Website template" className="mt-3 grid gap-3 sm:grid-cols-3">
        {templates.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={template === t.key} onClick={() => setTemplate(t.key)} className={card(template === t.key)}>
            <span className="block text-sm font-medium text-[var(--ds-on-surface)]">{t.name}</span>
            <span className="mt-1 block text-xs text-[var(--ds-on-surface-muted)]">{t.description}</span>
          </button>
        ))}
      </div>
      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Colours</h2>
      <div role="radiogroup" aria-label="Colour theme" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {presets.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} onClick={() => setPreset(p.key)} className={card(preset === p.key)}>
            <span className="flex gap-1.5" aria-hidden>
              {[p.primary, p.secondary, p.accent].map((c, i) => <span key={i} className="h-5 w-5 rounded-full" style={{ background: c }} />)}
            </span>
            <span className="mt-2 block text-sm text-[var(--ds-on-surface)]">{p.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs text-[var(--ds-on-surface-muted)]">
        {publishedAt ? `Your site is already live (published ${publishedAt}). Publishing again updates it.` : "Your school name, logo and contact details fill in automatically. Edit every page later in Website."}
      </p>
      <StepFooter back={back} skip={skip} label="Publish my website" pending={pending}
        onClick={() => run(() => publishWebsite({ template, preset }), (d) => { if (d && (d as { themeApplied?: boolean }).themeApplied === false) toast("Published. Your plan keeps the colours as they were."); })} />
    </div>
  );
}
