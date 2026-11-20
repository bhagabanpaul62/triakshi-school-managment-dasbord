"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Section, SectionHeading } from "./ui";
import { EASE } from "./motion";

const STEPS = [
  { t: "Sign up", d: "Your school's name, board and city. About two minutes.", when: "You" },
  { t: "We check your school", d: "Our team reviews every school, usually within one business day.", when: "Our team" },
  { t: "Guided setup", d: "Classes, fee structure and staff, one checklist step at a time.", when: "You" },
  { t: "Import students", d: "From a spreadsheet, or add them one by one.", when: "You" },
  { t: "Go live", d: "Parents and students get their logins, and the 30-day trial starts.", when: "Everyone" },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  const view = { once: true, margin: "0px 0px -15% 0px" } as const;
  return (
    <Section id="how" tone="white" labelledBy="how-title">
      <SectionHeading id="how-title" kicker="How it works" title="From sign-up to first attendance in a few days." sub="No visit and nothing to install. You set it up from the dashboard, with a checklist to follow." />
      <ol className="relative mt-10 grid gap-0 md:mt-10 lg:grid-cols-5 lg:gap-6">
        {/* the rail: down the left on phones, across the top on desktop; it draws in once */}
        <span aria-hidden className="absolute bottom-8 left-[21px] top-2 w-0.5 bg-line lg:hidden" />
        <motion.span aria-hidden initial={reduce ? false : { scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={view} transition={{ duration: 1.2, ease: EASE }} style={{ originY: 0 }} className="absolute bottom-8 left-[21px] top-2 w-0.5 bg-green lg:hidden" />
        <span aria-hidden className="absolute left-5 right-[16%] top-[21px] hidden h-0.5 bg-line lg:block" />
        <motion.span aria-hidden initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={view} transition={{ duration: 1.2, ease: EASE }} style={{ originX: 0 }} className="absolute left-5 right-[16%] top-[21px] hidden h-0.5 bg-green lg:block" />
        {STEPS.map((s, n) => (
          <motion.li key={s.t} initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={view} transition={{ duration: 0.45, delay: 0.15 + n * 0.12, ease: EASE }}
            className="relative flex gap-5 pb-7 last:pb-0 lg:flex-col lg:gap-0 lg:pb-0">
            <span className={`relative z-10 grid size-11 shrink-0 place-items-center rounded-full text-[16px] font-bold tabular-nums ring-[6px] ring-white ${n === STEPS.length - 1 ? "bg-gold text-ink" : "bg-green text-white"}`}>{n + 1}</span>
            <div className="pt-1.5 lg:pt-6">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-mute">{s.when}</p>
              <h3 className="mt-1 text-[19px] font-semibold leading-snug">{s.t}</h3>
              <p className="text-pretty mt-1.5 max-w-sm text-[16px] leading-relaxed text-mute lg:text-[15.5px]">{s.d}</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </Section>
  );
}
