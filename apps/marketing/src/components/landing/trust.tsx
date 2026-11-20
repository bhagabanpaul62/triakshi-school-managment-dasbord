"use client";

import { motion, useReducedMotion } from "framer-motion";
import { IconDatabase, IconDatabaseExport, IconHistory, IconShieldLock, IconCloudLock } from "@tabler/icons-react";
import { Section, SectionHeading, TINT, type Tint } from "./ui";
import { rise } from "./motion";

const ITEMS: { icon: typeof IconDatabase; t: string; d: string; tint: Tint }[] = [
  { icon: IconDatabase, t: "Every school kept apart", d: "Each school's data is isolated in the database itself, not only in the app. One school can never see another's records.", tint: "sky" },
  { icon: IconHistory, t: "An audit log of every change", d: "Who changed a fee, a mark or a profile, and when. Your admin can look it up.", tint: "cream" },
  { icon: IconShieldLock, t: "Two-step sign-in for our staff", d: "Everyone on our team signs in with a second step before they can reach the platform.", tint: "lilac" },
  { icon: IconCloudLock, t: "Daily encrypted backups", d: "A backup every day, encrypted, so a bad day does not cost you a year of records.", tint: "mint" },
  { icon: IconDatabaseExport, t: "Export any time", d: "Take all your data out as spreadsheet files, even after a trial ends.", tint: "rose" },
];

export function Trust() {
  const reduce = useReducedMotion();
  return (
    <Section id="trust" labelledBy="trust-title">
      {/* The heading takes the first cell, the five promises fill a 3 x 2 grid: two short rows instead of a tall list. */}
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionHeading id="trust-title" kicker="Trust & security" title="Children's data, treated that way." sub="Five things we do for every school, on every plan." className="mb-7 sm:col-span-2 lg:col-span-1 lg:mb-0 lg:pr-4" />
        <ul role="list" className="contents">
          {ITEMS.map((it, i) => (
            <motion.li key={it.t} {...rise(reduce, i * 0.06, 12)} className="flex gap-4 rounded-[24px] bg-white p-5 md:p-6">
              <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-2xl text-green ${TINT[it.tint]}`}><it.icon size={24} stroke={1.8} /></span>
              <div>
                <h3 className="text-[18px] font-semibold leading-snug">{it.t}</h3>
                <p className="text-pretty mt-1 text-[15.5px] leading-relaxed text-mute">{it.d}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
