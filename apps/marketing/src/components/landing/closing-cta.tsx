"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ButtonLink, Container } from "./ui";
import { EASE } from "./motion";

/** The clock tower from the hero, drawn flat in chalkboard green. */
function Tower() {
  const reduce = useReducedMotion();
  const g = "#22403a";
  return (
    <svg viewBox="0 0 240 300" aria-hidden className="h-full w-auto">
      <polygon points="70,92 120,30 170,92" fill={g} />
      <line x1="120" y1="32" x2="120" y2="8" stroke={g} strokeWidth="4" /><circle cx="120" cy="8" r="6" fill="#fff" />
      <rect x="60" y="88" width="120" height="14" rx="3" fill={g} />
      <rect x="74" y="102" width="92" height="198" fill="#f9efd8" />
      <path d="M96 160V128a24 24 0 0 1 48 0V160Z" fill={g} />
      <motion.g style={{ originX: 0.5, originY: 0 }} animate={reduce ? undefined : { rotate: [-10, 10, -10] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
        <line x1="120" y1="112" x2="120" y2="122" stroke="#e8a317" strokeWidth="3" />
        <path d="M106 150Q106 124 120 121Q134 124 134 150L138 155H102Z" fill="#e8a317" /><circle cx="120" cy="158" r="3.5" fill="#e8a317" />
      </motion.g>
      <rect x="66" y="160" width="108" height="10" rx="3" fill={g} />
      <circle cx="120" cy="222" r="34" fill="#fff" stroke={g} strokeWidth="7" />
      <line x1="120" y1="222" x2="104" y2="214" stroke="#15181a" strokeWidth="4" strokeLinecap="round" />
      <line x1="120" y1="222" x2="132" y2="200" stroke="#15181a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="120" cy="222" r="4" fill="#15181a" />
    </svg>
  );
}

export function ClosingCta() {
  const reduce = useReducedMotion();
  return (
    <section aria-labelledby="cta-title" className="pb-16 md:pb-24">
      <Container>
        <motion.div initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -10% 0px" }} transition={{ duration: 0.55, ease: EASE }}
          className="relative overflow-hidden rounded-[32px] bg-gold md:rounded-[44px]">
          <div className="relative z-10 px-6 pb-4 pt-10 sm:px-12 sm:pt-14 md:max-w-[64%] md:pb-14 lg:px-16 lg:py-16">
            <h2 id="cta-title" className="h-display text-[clamp(2.2rem,4.8vw,3.9rem)] text-ink">Open your school&rsquo;s dashboard this week.</h2>
            <p className="text-pretty mt-5 max-w-lg text-[17px] leading-relaxed text-ink/80 md:text-[19px]">Two minutes to sign up, a quick check by our team, then 30 days to try it with real classes. No card.</p>
            <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
              <ButtonLink href="/signup" variant="ink">Start free trial</ButtonLink>
              <ButtonLink href="/pricing" variant="ghost" className="!border-transparent">See pricing</ButtonLink>
            </div>
            <p className="mt-5 text-[14.5px] font-medium text-ink/75">Export your data any time.</p>
          </div>
          <div aria-hidden className="flex h-56 justify-end pr-6 sm:h-64 md:absolute md:bottom-0 md:right-10 md:h-[80%] md:pr-0 lg:right-24">
            <Tower />
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
