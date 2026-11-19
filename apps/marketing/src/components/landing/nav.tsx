"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { IconArrowRight, IconMenu2, IconX } from "@tabler/icons-react";
import { NAV } from "@/lib/nav";
import { ButtonLink } from "./ui";
import { EASE } from "./motion";

export function Logo() {
  return (
    <Link href="/" className="h-display flex min-h-11 items-center gap-2.5 text-[23px] leading-none" aria-label="Triakshi home">
      <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-green text-[16px] text-gold">T</span>Triakshi
    </Link>
  );
}

export function SiteHeader() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 8));

  // The open sheet owns the screen: no page scroll behind it, Escape closes it and gives focus back.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    const wide = () => { if (window.innerWidth >= 1024) setOpen(false); };
    window.addEventListener("keydown", esc);
    window.addEventListener("resize", wide);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); window.removeEventListener("resize", wide); };
  }, [open]);

  return (
    <header className={`sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] transition-colors duration-200 ${scrolled || open ? "border-line bg-paper" : "border-transparent bg-paper"}`}>
      <div className="wrap flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 text-[15px] font-medium lg:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-mute transition-colors duration-200 hover:bg-white hover:text-ink">{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/#faq" className="hidden min-h-11 items-center rounded-full px-4 text-[15px] font-semibold text-ink hover:bg-white lg:inline-flex">Sign in</Link>
          <ButtonLink href="/signup" onClick={() => setOpen(false)} className="!min-h-11 !px-5 text-[15px] max-[359px]:!px-3.5 max-[359px]:text-[14px]">Start free trial</ButtonLink>
          <button ref={toggle} type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}
            className="grid size-11 place-items-center rounded-full border border-line-strong bg-white lg:hidden">
            {open ? <IconX size={20} aria-hidden /> : <IconMenu2 size={20} aria-hidden />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open ? (
          <motion.div id="mobile-menu" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-x-0 bottom-0 top-[calc(4rem+env(safe-area-inset-top)+1px)] z-40 overflow-y-auto bg-paper lg:hidden">
            <nav aria-label="Mobile" className="wrap flex min-h-full flex-col pb-[max(24px,env(safe-area-inset-bottom))] pt-4">
              <ul>
                {[...NAV, { href: "/#faq", label: "Sign in" }].map((n, i) => (
                  <motion.li key={n.label} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.04 * i, ease: EASE }}>
                    <Link href={n.href} onClick={() => setOpen(false)} className="h-display flex min-h-16 items-center justify-between border-b border-line text-[28px]">
                      {n.label}<IconArrowRight size={22} aria-hidden className="text-mute" />
                    </Link>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-auto pt-8">
                <ButtonLink href="/signup" className="w-full" onClick={() => setOpen(false)}>Start free trial</ButtonLink>
                <p className="mt-3 text-center text-[14.5px] text-mute">30 days free. No card needed.</p>
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
