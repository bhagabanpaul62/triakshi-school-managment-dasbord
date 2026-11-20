"use client";

import { motion, useReducedMotion } from "framer-motion";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { Section, SectionHeading } from "./ui";
import { rise } from "./motion";

const COLS = ["Registers & WhatsApp", "Spreadsheets", "Triakshi"] as const;
const ROWS: { k: string; v: [string, string, string] }[] = [
  { k: "Fee receipts", v: ["Hand-written, and the carbon copy gets lost.", "Typed each time. Numbers can skip or repeat.", "Numbered in order, as a PDF in one tap."] },
  { k: "Attendance", v: ["Paper register, totals added up at month end.", "One sheet per class, no alerts.", "Marked in a minute, parents told the same morning."] },
  { k: "Report cards", v: ["Written out by hand for every child.", "A mail-merge that breaks on the last day.", "Marks go in once, the PDF comes out."] },
  { k: "Parent updates", v: ["Quick, but easy to miss in a busy group.", "Not a way to reach parents.", "A notice to the right class, on the family's login."] },
  { k: "School website", v: ["A social media page, if someone has time.", "Not what it is for.", "A template site on your own domain, with enquiries."] },
  { k: "Data safety", v: ["One copy, in a cupboard.", "On one laptop or a shared drive.", "Kept apart per school, backed up daily."] },
  { k: "Cost", v: ["Cheap in rupees, costly in staff hours.", "Free to start, slow to keep up.", "A plan by student count. 30 days free to try."] },
];

export function Compare() {
  const reduce = useReducedMotion();
  return (
    <Section id="compare" tone="white" labelledBy="compare-title">
      <SectionHeading id="compare-title" kicker="Compared" title="How it differs from what most schools use today." sub="Registers and WhatsApp do some things well. This is where they run out." />

      {/* tablet and up: a real table */}
      <motion.div {...rise(reduce, 0.05)} className="mt-10 hidden overflow-hidden rounded-[28px] bg-paper md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Triakshi compared with registers, WhatsApp and spreadsheets</caption>
          <colgroup><col className="w-[19%]" /><col /><col /><col className="w-[30%]" /></colgroup>
          <thead>
            <tr className="text-[14px]">
              <td className="px-5 py-4" />
              {COLS.map((c, i) => <th key={c} scope="col" className={`px-5 py-4 font-semibold ${i === 2 ? "bg-green text-[15px] text-white" : "text-mute"}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.k} className="border-t border-line align-top">
                <th scope="row" className="px-5 py-4 text-[16px] font-semibold">{r.k}</th>
                {r.v.map((t, i) => (
                  <td key={i} className={`px-5 py-4 text-[15.5px] leading-snug ${i === 2 ? "bg-t-green font-medium text-ink" : "text-mute"}`}>
                    {i === 2 ? <span className="flex gap-2.5"><IconCheck size={18} stroke={2.6} aria-hidden className="mt-0.5 shrink-0 text-green" />{t}</span> : t}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      {/* phones: one card per row, Triakshi's answer first */}
      <ul className="mt-8 flex flex-col gap-3 md:hidden">
        {ROWS.map((r, n) => (
          <motion.li key={r.k} {...rise(reduce, Math.min(n, 2) * 0.05, 12)} className="rounded-[24px] bg-paper p-5">
            <h3 className="text-[18px] font-semibold">{r.k}</h3>
            <p className="mt-3 flex gap-2.5 rounded-2xl bg-t-green p-3.5 text-[16px] font-medium leading-snug">
              <IconCheck size={18} stroke={2.6} aria-hidden className="mt-0.5 shrink-0 text-green" /><span><span className="sr-only">Triakshi: </span>{r.v[2]}</span>
            </p>
            <dl className="mt-3 flex flex-col gap-2 px-1 text-[15px] leading-snug">
              {[0, 1].map((i) => (
                <div key={i} className="flex gap-2.5">
                  <IconMinus size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                  <div><dt className="inline font-semibold text-ink">{COLS[i]}: </dt><dd className="inline text-mute">{r.v[i]}</dd></div>
                </div>
              ))}
            </dl>
          </motion.li>
        ))}
      </ul>
    </Section>
  );
}
