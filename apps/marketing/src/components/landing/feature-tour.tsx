"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { IconCheck, IconChalkboard, IconCoin, IconSchool, IconUserCircle, IconUsers } from "@tabler/icons-react";
import { AttendanceMock, DashboardMock, ParentUpdatesMock, ReceiptMock, StudentMock } from "../mocks";
import { Section, SectionHeading, TINT, type Tint } from "./ui";
import { EASE } from "./motion";

type Tab = { key: string; label: string; icon: typeof IconSchool; who: string; title: string; points: string[]; tint: Tint; mock: ReactNode };

const TABS: Tab[] = [
  { key: "admin", label: "Admin", icon: IconSchool, who: "Principal and office", tint: "green", title: "The whole school day, on one screen.", points: ["Today's attendance, fees collected and dues in one view.", "Set up classes, staff and the timetable once, change them when you need to.", "Invite teachers by email, and switch off their access when they leave."], mock: <DashboardMock /> },
  { key: "accountant", label: "Accounts", icon: IconCoin, who: "Fee counter", tint: "rose", title: "Receipts at the counter, dues without a spreadsheet.", points: ["Record cash, UPI or cheque and print a numbered receipt.", "Fee structures with instalments, set per class.", "See who owes what, and remind them from the same screen."], mock: <ReceiptMock /> },
  { key: "teacher", label: "Teacher", icon: IconChalkboard, who: "Class and subject teachers", tint: "cream", title: "Mark the class in a minute, then get on with teaching.", points: ["Present is the default, so tap only the absentees.", "Post homework, collect the work and give marks.", "Enter exam marks once, and the report card builds itself."], mock: <AttendanceMock /> },
  { key: "parent", label: "Parent", icon: IconUsers, who: "Every family", tint: "sky", title: "Everything about their child, in one place.", points: ["Told the same morning if their child is absent.", "Fee dues, receipts and notices in one list.", "Homework and results on the phone they already have."], mock: <ParentUpdatesMock /> },
  { key: "student", label: "Student", icon: IconUserCircle, who: "Every student", tint: "lilac", title: "Today's periods and homework, without asking.", points: ["The day's timetable, always up to date.", "Homework with due dates, and a hand-in button.", "Marks and report cards after each exam."], mock: <StudentMock /> },
];

const AUTO_MS = 7000;

export function FeatureTour() {
  const reduce = useReducedMotion();
  const id = useId();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touched, setTouched] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, { amount: 0.4 });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Auto-advance only while visible, un-hovered and until the visitor picks a tab.
  useEffect(() => {
    if (reduce || paused || touched || !seen) return;
    const t = setTimeout(() => setI((v) => (v + 1) % TABS.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [i, reduce, paused, touched, seen]);

  const pick = (n: number) => { setTouched(true); setI(n); };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(k)) return;
    e.preventDefault();
    const n = k === "Home" ? 0 : k === "End" ? TABS.length - 1 : (i + (k === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    pick(n);
    tabRefs.current[n]?.focus();
  };
  const tab = TABS[i]!;

  return (
    <Section id="tour" tone="white" labelledBy="tour-title">
      <SectionHeading id="tour-title" kicker="The product" title="One school, five different screens." sub="Each person signs in and sees only what their job needs. Pick a role." />
      <div ref={box} className="mt-9 md:mt-10" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        {/* phones: five equal icon tabs in a row; wider: a pill row */}
        <div role="tablist" aria-label="Roles" onKeyDown={onKey} className="grid grid-cols-5 gap-1 rounded-[22px] bg-paper p-1 sm:inline-flex sm:rounded-full">
          {TABS.map((t, n) => (
            <button key={t.key} ref={(el) => { tabRefs.current[n] = el; }} type="button" role="tab" id={`${id}-t-${t.key}`} aria-selected={n === i} aria-controls={`${id}-p`} tabIndex={n === i ? 0 : -1} onClick={() => pick(n)}
              className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 text-[12.5px] font-semibold transition-colors duration-200 sm:min-h-11 sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:text-[15px] ${n === i ? "text-white" : "text-mute hover:text-ink"}`}>
              {n === i ? <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-[18px] bg-green sm:rounded-full" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }} /> : null}
              <t.icon size={19} aria-hidden className="relative" /><span className="relative">{t.label}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t-${tab.key}`} className={`mt-4 rounded-[28px] p-4 transition-colors duration-500 sm:p-6 md:mt-5 md:rounded-[36px] lg:p-10 ${TINT[tab.tint]}`}>
          <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab.key + "-t"} className="px-1 pt-2 sm:px-0 sm:pt-0" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
                <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-green">{tab.who}</p>
                <h3 className="h-display mt-2 text-[clamp(1.6rem,3vw,2.35rem)] leading-[1.08]">{tab.title}</h3>
                <ul className="mt-5 flex flex-col gap-3">
                  {tab.points.map((p, n) => (
                    <motion.li key={p} initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.08 + n * 0.06, ease: EASE }} className="flex gap-3 text-[16px] leading-snug">
                      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white text-green"><IconCheck size={14} stroke={3} /></span>{p}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab.key + "-m"} initial={reduce ? false : { opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }} className="min-w-0">
                {tab.mock}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Section>
  );
}
