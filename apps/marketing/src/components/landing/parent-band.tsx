"use client";

import { motion, useReducedMotion } from "framer-motion";
import { IconBell, IconCalendarCheck, IconCertificate, IconCurrencyRupee, IconDeviceMobile, IconHome, IconNotebook, IconUser, IconUserCircle, IconUsers } from "@tabler/icons-react";
import { Section, SectionHeading, ButtonLink } from "./ui";
import { EASE, rise } from "./motion";

const POINTS = [
  { icon: IconUsers, t: "Parents see their own child", d: "Attendance, homework, fee dues and results in one list, on the phone they already have." },
  { icon: IconUserCircle, t: "Students see their own day", d: "The timetable, homework with due dates, and marks after each exam." },
  { icon: IconDeviceMobile, t: "Nothing to install", d: "They sign in from the phone's browser. You send the login, they are in." },
];

function Phone() {
  const reduce = useReducedMotion();
  const tiles = [
    { icon: IconCalendarCheck, k: "Attendance", v: "Present today", c: "bg-t-green" },
    { icon: IconNotebook, k: "Homework", v: "2 due this week", c: "bg-t-cream" },
    { icon: IconCurrencyRupee, k: "Fees", v: "₹4,200 due", c: "bg-t-rose" },
    { icon: IconCertificate, k: "Results", v: "Term 1 is out", c: "bg-t-sky" },
  ];
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 40, rotate: 4 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true, margin: "0px 0px -10% 0px" }} transition={{ duration: 0.6, ease: EASE }} className="mx-auto w-full max-w-[min(300px,82vw)]">
      <motion.div animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <figure aria-label="Parent view on a phone, with sample data" className="overflow-hidden rounded-[44px] border-[9px] border-ink bg-paper text-ink shadow-lift">
          <div aria-hidden className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold"><span>9:05</span><span className="h-5 w-20 rounded-full bg-ink" /><span>4G</span></div>
          <div className="px-4 pb-4 pt-2">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-green text-[14px] font-bold text-gold">AS</span>
              <div><p className="text-[12px] text-mute">Good morning</p><p className="text-[16px] font-semibold leading-tight">Aarav · Class 8-B</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {tiles.map((t, i) => (
                <motion.div key={t.k} initial={reduce ? false : { opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: 0.45 + i * 0.08, ease: EASE }} className={`rounded-2xl p-3 ${t.c}`}>
                  <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-white text-green"><t.icon size={17} /></span>
                  <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-mute">{t.k}</p>
                  <p className="text-[14px] font-semibold leading-tight">{t.v}</p>
                </motion.div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2.5 rounded-2xl bg-white p-3 text-[13px]">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-gold-soft text-warn"><IconBell size={15} /></span>
              <span className="min-w-0 leading-snug"><span className="font-semibold">PTM on Saturday</span><span className="text-mute"> · 10 am, Class 8-B</span></span>
            </div>
          </div>
          <div aria-hidden className="flex justify-around border-t border-line bg-white py-2.5 text-mute">
            <IconHome size={20} className="text-green" /><IconCalendarCheck size={20} /><IconCurrencyRupee size={20} /><IconUser size={20} />
          </div>
        </figure>
        <p className="mt-3 text-center text-[12px] text-green-ink">Sample data</p>
      </motion.div>
    </motion.div>
  );
}

export function ParentBand() {
  const reduce = useReducedMotion();
  return (
    <Section tone="green" id="apps" labelledBy="apps-title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <SectionHeading id="apps-title" tone="dark" kicker="For families" title="Parents and students get their own view." />
          <ul className="mt-8 flex flex-col gap-6">
            {POINTS.map((p, i) => (
              <motion.li key={p.t} {...rise(reduce, 0.1 + i * 0.08, 12)} className="flex gap-4">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-gold"><p.icon size={22} stroke={1.8} /></span>
                <div><h3 className="text-[18px] font-semibold text-white">{p.t}</h3><p className="text-pretty mt-1 max-w-md text-[16px] leading-relaxed text-green-ink">{p.d}</p></div>
              </motion.li>
            ))}
          </ul>
          <div className="mt-9"><ButtonLink href="/signup" variant="onGreen">Start free trial</ButtonLink></div>
        </div>
        <Phone />
      </div>
    </Section>
  );
}
