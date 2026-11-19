"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconPlus } from "@tabler/icons-react";

const QA = [
  ["What happens after the 30-day trial?", "Pick a plan to continue. If you do not, your school goes read-only for 14 days so you can still export everything, then is suspended. Your data is kept for 90 days after that before it is deleted."],
  ["Do I need a card to start?", "No. Sign up with your school's details and email. You pay only when you choose a plan."],
  ["Can parents pay fees in the app?", "Not in the app. Parents pay the school the way they do today, in cash, by UPI or by cheque. The office records it, and the receipt and the dues update at once."],
  ["Will it work with our academic year and board?", "The year runs April to March. Classes, sections, subjects and grading are set up by you, so CBSE, ICSE and state-board schools can all use it."],
  ["How do we sign in after approval?", "Each school gets its own web address, like yourschool plus our domain. The link to it comes in your approval email, and every teacher, parent and student signs in there."],
  ["Where is our data stored?", "On servers in India. Each school's data is isolated from every other school's at the database level, not just in the app."],
  ["Can parents and students log in?", "Yes. Teachers, accountants, students and parents each get their own login and see only what their role allows. It runs in the phone's browser, with nothing to install."],
  ["Can we bring our existing student list?", "Yes. The setup wizard imports students from a spreadsheet, and you can invite staff by email."],
  ["Can we take our data out?", "Yes, at any time, including during the read-only period after a trial ends."],
  ["Do you issue GST invoices?", "Yes. Every payment gets a GST invoice with our GSTIN, and yours if you give it to us. Prices on this site exclude 18% GST."],
] as const;

export function Faq() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">
      {QA.map(([q, a], i) => {
        const on = open === i;
        return (
          <div key={q}>
            <h3>
              <button type="button" aria-expanded={on} aria-controls={`faq-${i}`} id={`faq-b-${i}`} onClick={() => setOpen(on ? null : i)}
                className="flex min-h-14 w-full items-center justify-between gap-5 px-5 py-4 text-left text-[16.5px] font-semibold">
                {q}
                <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-200 ${on ? "bg-green text-white" : "bg-paper text-ink"}`}>
                  <IconPlus size={16} className={`transition-transform duration-200 ${on ? "rotate-45" : ""}`} />
                </span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {on ? (
                <motion.div id={`faq-${i}`} role="region" aria-labelledby={`faq-b-${i}`} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: "easeOut" }} className="overflow-hidden">
                  <p className="max-w-2xl px-5 pb-5 leading-relaxed text-mute">{a}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
