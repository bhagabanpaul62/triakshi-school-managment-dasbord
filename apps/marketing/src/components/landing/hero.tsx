"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { IconCalendarCheck, IconCheck, IconCurrencyRupee, IconClockHour4 } from "@tabler/icons-react";
import { ButtonLink, Container, Kicker, Mark } from "./ui";
import { EASE } from "./motion";
import { SchoolIllustration } from "./school-illustration";

// Sample numbers on the chips; they sit over sky and road, never over the building.
const CHIPS = [
  { icon: IconCalendarCheck, k: "Attendance today", v: "96.4% present", pos: "left-[3%] top-[3%] sm:left-[4%] sm:top-[5%]", show: "", delay: 2.4 },
  { icon: IconClockHour4, k: "Timetable", v: "Class 7-B published", pos: "right-[4%] top-[7%]", show: "hidden sm:block", delay: 2.65 },
  { icon: IconCurrencyRupee, k: "Fees this week", v: "₹2.4L collected", pos: "right-[4%] bottom-[4%]", show: "", delay: 2.9 },
] as const;

export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const chipY = [useTransform(scrollYProgress, [0, 1], [0, -40]), useTransform(scrollYProgress, [0, 1], [0, -70]), useTransform(scrollYProgress, [0, 1], [0, -24])];
  const up = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, delay: d, ease: EASE } });

  return (
    <section ref={ref} aria-labelledby="hero-title" className="pb-14 pt-6 md:pb-20 md:pt-10 lg:pt-14">
      <Container className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
        <div>
          <motion.div {...up(0)}><Kicker>School management for India</Kicker></motion.div>
          <motion.h1 {...up(0.06)} id="hero-title" className="h-display mt-5 text-[clamp(2.55rem,5.7vw,4.6rem)]">
            Run your whole school from one <Mark>calm</Mark> dashboard.
          </motion.h1>
          <motion.p {...up(0.14)} className="text-pretty mt-5 max-w-xl text-[17px] leading-relaxed text-mute md:text-[19px]">
            Attendance in the morning, fee receipts at the counter, report cards in March. One place for the office, teachers, students and parents.
          </motion.p>
          <motion.div {...up(0.22)} className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
            <ButtonLink href="/signup">Start free trial</ButtonLink>
            <ButtonLink href="/#modules" variant="ghost">See every module</ButtonLink>
          </motion.div>
          <motion.ul {...up(0.3)} className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14.5px] text-mute">
            {["30 days free", "No card needed", "Every school checked by our team"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><IconCheck size={16} stroke={2.6} aria-hidden className="text-green" />{t}</li>
            ))}
          </motion.ul>
        </div>

        <motion.div initial={reduce ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1, ease: EASE }} className="relative">
          <div className="relative aspect-[6/5] overflow-hidden rounded-[28px] sm:aspect-[16/10] md:rounded-[36px] lg:aspect-[5/4]">
            <SchoolIllustration progress={scrollYProgress} className="absolute inset-0 size-full" />
          </div>
          {CHIPS.map((c, i) => (
            <motion.div key={c.k} aria-hidden style={reduce ? undefined : { y: chipY[i] }} className={`absolute ${c.pos} ${c.show}`}>
              <motion.div initial={reduce ? false : { opacity: 0, y: 10, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, delay: reduce ? 0 : c.delay, ease: EASE }}
                className="flex items-center gap-2.5 rounded-2xl bg-white py-2 pl-2 pr-3.5 shadow-lift sm:py-2.5 sm:pl-2.5 sm:pr-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold-soft text-warn sm:size-9"><c.icon size={18} /></span>
                <span className="leading-tight">
                  <span className="hidden text-[12px] font-medium text-mute sm:block">{c.k}</span>
                  <span className="block whitespace-nowrap text-[13px] font-semibold sm:text-[14.5px]">{c.v}</span>
                </span>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
