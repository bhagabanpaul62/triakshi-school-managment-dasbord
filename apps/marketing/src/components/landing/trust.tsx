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
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <SectionHeading id="trust-title" kicker="Trust & security" title="Student records are children's data. We treat them that way." sub="Five things we do for every school, on every plan." className="lg:sticky lg:top-28 lg:self-start" />
        <ul className="overflow-hidden rounded-[28px] bg-white">
          {ITEMS.map((it, i) => (
            <motion.li key={it.t} {...rise(reduce, i * 0.06, 12)} className="flex gap-4 border-b border-line p-5 last:border-b-0 md:gap-5 md:px-7 md:py-6">
              <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-2xl text-green ${TINT[it.tint]}`}><it.icon size={24} stroke={1.8} /></span>
              <div>
                <h3 className="text-[18px] font-semibold leading-snug">{it.t}</h3>
                <p className="text-pretty mt-1 text-[16px] leading-relaxed text-mute">{it.d}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
