"use client";

import { motion, useReducedMotion } from "framer-motion";
import { IconInbox, IconLink, IconLock, IconPalette } from "@tabler/icons-react";
import { Section, SectionHeading } from "./ui";
import { rise } from "./motion";

const POINTS = [
  [IconPalette, "Start from a template", "Pick a layout, add your photos and notices. Your school's colour and logo carry through."],
  [IconLink, "On your own domain", "Use an address you already own, or start on ours and move later."],
  [IconInbox, "Enquiries come to you", "The admission form on your site lands in your dashboard, not in someone's personal email."],
] as const;

function SiteMock() {
  return (
    <figure aria-label="A school website made with the builder, sample" className="overflow-hidden rounded-[24px] bg-white shadow-lift md:rounded-[28px]">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3" aria-hidden>
        <span className="flex gap-1.5"><span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" /></span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full bg-white px-3 py-1 text-[12px] text-mute"><IconLock size={12} className="shrink-0" />sunrisepublic.school</span>
      </div>
      <div className="p-4 sm:p-5" aria-hidden>
        <div className="flex items-center justify-between gap-3 text-[12px] font-semibold">
          <span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-md bg-green text-[11px] text-gold">S</span>Sunrise Public School</span>
          <span className="hidden gap-4 text-mute sm:flex"><span>About</span><span>Admissions</span><span>Notices</span><span>Contact</span></span>
        </div>
        <div className="mt-4 grid gap-4 rounded-2xl bg-t-green p-4 sm:grid-cols-[1.25fr_1fr] sm:p-5">
          <div>
            <p className="h-display text-[clamp(1.25rem,2.2vw,1.6rem)] leading-tight">Admissions open for 2027-28</p>
            <p className="mt-1.5 text-[12px] text-mute">Nursery to Class 12 · CBSE</p>
            <span className="mt-3 inline-block rounded-full bg-gold px-4 py-1.5 text-[12px] font-semibold text-ink">Apply now</span>
          </div>
          <div className="rounded-xl bg-white p-3 text-[11px]">
            <p className="font-semibold">Admission enquiry</p>
            <p className="mt-2 rounded-md bg-paper px-2 py-1.5 text-mute">Parent&rsquo;s name</p>
            <p className="mt-1.5 rounded-md bg-paper px-2 py-1.5 text-mute">Class 1</p>
            <p className="mt-2 inline-block rounded-md bg-green px-3 py-1.5 font-semibold text-white">Send</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {["Notices", "Gallery", "Fee details"].map((t) => <p key={t} className="rounded-xl bg-paper px-3 py-2.5 text-[11.5px] font-semibold">{t}</p>)}
        </div>
      </div>
    </figure>
  );
}

export function WebsiteSection() {
  const reduce = useReducedMotion();
  return (
    <Section id="website" labelledBy="website-title">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading id="website-title" kicker="Online presence" title="Your school gets a website too." sub="Parents look your school up before they call. Give them a proper site, and keep every enquiry in one place." />
          <ul className="mt-8 flex flex-col gap-5">
            {POINTS.map(([Icon, t, d], i) => (
              <motion.li key={t} {...rise(reduce, i * 0.07, 12)} className="flex gap-4">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-t-mint text-green"><Icon size={22} stroke={1.8} /></span>
                <div><h3 className="text-[18px] font-semibold">{t}</h3><p className="text-pretty mt-1 text-[16px] leading-relaxed text-mute">{d}</p></div>
              </motion.li>
            ))}
          </ul>
        </div>
        <div className="relative pb-10 sm:pb-12">
          <motion.div {...rise(reduce, 0, 24)}><SiteMock /></motion.div>
          <motion.div {...rise(reduce, 0.25, 16)} className="absolute bottom-0 right-3 w-[min(320px,88%)] rounded-2xl bg-white p-3.5 shadow-lift sm:right-6">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-warn"><IconInbox size={20} /></span>
              <div className="min-w-0 text-[14px] leading-snug"><p className="font-semibold">New enquiry · Class 1</p><p className="truncate text-mute">Mrs Gupta, via your site</p></div>
              <span className="ml-auto shrink-0 rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-semibold text-warn">New</span>
            </div>
          </motion.div>
        </div>
      </div>
    </Section>
  );
}
