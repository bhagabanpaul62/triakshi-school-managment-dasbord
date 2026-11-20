"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconPlus } from "@tabler/icons-react";
import { GROUPS, MODULE_COUNT, type Mod } from "./modules-data";
import { ButtonLink, Card, Section, SectionHeading } from "./ui";
import { EASE, rise } from "./motion";

/** One module as a single row: name only until tapped, then its line, what it does and who uses it. */
function ModuleItem({ m, open, onToggle }: { m: Mod; open: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  const id = `mod-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <li className={`rounded-2xl transition-colors duration-200 ${open ? "bg-white shadow-soft" : "hover:bg-white/70"}`}>
      <h4>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-green"><m.icon size={18} stroke={1.8} /></span>
          <span className="min-w-0 flex-1 text-[16px] font-semibold leading-tight">{m.name}</span>
          <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-200 ${open ? "bg-green text-white" : "bg-white text-ink"}`}>
            <IconPlus size={14} stroke={2.4} className={`transition-transform duration-300 ${open ? "rotate-45" : ""}`} />
          </span>
        </button>
      </h4>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="more" id={id} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <div className="px-3 pb-4">
              <p className="text-pretty text-[15px] leading-snug text-mute">{m.line}</p>
              <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[15px]">
                {m.bullets.map((b) => <li key={b} className="flex gap-2.5"><span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-gold" />{b}</li>)}
              </ul>
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-mute">
                <span className="mr-0.5">Used by</span>
                {m.who.map((w) => <span key={w} className="rounded-full bg-paper px-2.5 py-1 font-semibold text-ink">{w}</span>)}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/** Seven group cards in a grid (not a stack of full-width rows), so every module is visible in about one screen. */
export function Modules() {
  const reduce = useReducedMotion();
  const [openName, setOpenName] = useState<string | null>(null);
  return (
    <Section id="modules" labelledBy="modules-title">
      <SectionHeading id="modules-title" kicker="Every module" title="Everything a school office runs, in one place." sub={`${MODULE_COUNT} modules in seven groups, all in every plan. Tap one to see what it does and who uses it.`} />
      <div className="mt-10 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:mt-10">
        {GROUPS.map((g, gi) => (
          <motion.section key={g.name} aria-labelledby={`grp-${gi}`} {...rise(reduce, Math.min(gi, 3) * 0.05, 14)}>
            <Card tint={g.tint} className="p-3">
              <div className="px-3 pb-3 pt-2">
                <h3 id={`grp-${gi}`} className="h-display text-[24px]">{g.name}</h3>
                <p className="mt-1 text-[15px] leading-snug text-mute">{g.line}</p>
              </div>
              <ul className="flex flex-col gap-1">
                {g.mods.map((m) => (
                  <ModuleItem key={m.name} m={m} open={openName === m.name} onToggle={() => setOpenName(openName === m.name ? null : m.name)} />
                ))}
              </ul>
            </Card>
          </motion.section>
        ))}
        {/* Fills the grid's one empty cell at 2 and 4 columns; with 3 columns two cells stay empty, so it hides. */}
        <div className="hidden rounded-[28px] border border-ink/12 p-6 sm:block lg:hidden xl:block">
          <p className="h-display text-[24px]">No add-ons.</p>
          <p className="text-pretty mt-2 text-[15px] leading-snug text-mute">All {MODULE_COUNT} modules come with every plan. You pay by student count, not by module.</p>
          <ButtonLink href="/pricing" variant="ghost" className="mt-5">See pricing</ButtonLink>
        </div>
      </div>
    </Section>
  );
}
