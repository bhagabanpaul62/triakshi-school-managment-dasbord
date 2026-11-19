"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconPlus } from "@tabler/icons-react";
import { GROUPS, MODULE_COUNT, type Mod } from "./modules-data";
import { Section, SectionHeading, TINT, type Tint } from "./ui";
import { EASE, rise } from "./motion";

function ModuleItem({ m, tint, open, onToggle, index }: { m: Mod; tint: Tint; open: boolean; onToggle: () => void; index: number }) {
  const reduce = useReducedMotion();
  const id = `mod-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <motion.li {...rise(reduce, Math.min(index, 3) * 0.05, 12)} className={`rounded-[22px] transition-colors duration-200 ${open ? "bg-white shadow-soft" : "hover:bg-white/70"}`}>
      <h4>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="block w-full rounded-[22px] p-4 text-left">
          <span className="flex items-center gap-3">
            <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl text-green ${TINT[tint]}`}><m.icon size={21} stroke={1.8} /></span>
            <span className="min-w-0 flex-1 text-[17px] font-semibold leading-tight">{m.name}</span>
            <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-200 ${open ? "bg-green text-white" : "bg-white text-ink"}`}>
              <IconPlus size={15} stroke={2.4} className={`transition-transform duration-300 ${open ? "rotate-45" : ""}`} />
            </span>
          </span>
          <span className="text-pretty mt-2.5 block text-[15.5px] leading-snug text-mute">{m.line}</span>
        </button>
      </h4>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="more" id={id} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <div className="px-4 pb-5">
              <ul className="flex flex-col gap-1.5 border-t border-line pt-3.5 text-[15.5px]">
                {m.bullets.map((b) => <li key={b} className="flex gap-2.5"><span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-gold" />{b}</li>)}
              </ul>
              <p className="mt-4 flex flex-wrap items-center gap-1.5 text-[13px] text-mute">
                <span className="mr-0.5">Used by</span>
                {m.who.map((w) => <span key={w} className="rounded-full bg-paper px-2.5 py-1 font-semibold text-ink">{w}</span>)}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

export function Modules() {
  const reduce = useReducedMotion();
  const [openName, setOpenName] = useState<string | null>(null);
  return (
    <Section id="modules" labelledBy="modules-title">
      <SectionHeading id="modules-title" kicker="Every module" title="Everything a school office runs, in one place." sub={`${MODULE_COUNT} modules in seven groups, all in every plan. Tap one to see what it does and who uses it.`} />
      <div className="mt-10 md:mt-14">
        {GROUPS.map((g, gi) => (
          <motion.section key={g.name} aria-labelledby={`grp-${gi}`} {...rise(reduce, 0, 14)}
            className="grid gap-x-8 gap-y-3 border-t border-ink/12 py-6 lg:grid-cols-[210px_minmax(0,1fr)]">
            <div className="lg:pt-4">
              <p className="text-[13px] font-semibold tabular-nums text-mute">{String(gi + 1).padStart(2, "0")}</p>
              <h3 id={`grp-${gi}`} className="h-display mt-1 text-[26px] md:text-[30px]">{g.name}</h3>
              <p className="mt-1.5 max-w-[24ch] text-[15.5px] leading-snug text-mute">{g.line}</p>
            </div>
            <ul className="-mx-4 grid items-start gap-1 sm:grid-cols-2 sm:gap-x-2 lg:grid-cols-3">
              {g.mods.map((m, i) => (
                <ModuleItem key={m.name} m={m} tint={g.tint} index={i} open={openName === m.name} onToggle={() => setOpenName(openName === m.name ? null : m.name)} />
              ))}
            </ul>
          </motion.section>
        ))}
      </div>
    </Section>
  );
}
