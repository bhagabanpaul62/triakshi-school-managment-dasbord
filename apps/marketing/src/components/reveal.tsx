"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** Fades and lifts its children in when they scroll into view. Does nothing for people who prefer reduced motion. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }} transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Bars that grow from zero once visible. `value` is 0-100. The full-size wrapper is what gets observed: a bar scaled to 0 has no area and may never report as visible. */
export function GrowBar({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="w-full" style={{ height: `${value}%` }}
      initial="hide" whileInView="show" viewport={{ once: true }}>
      <motion.div className={`h-full w-full ${className ?? ""}`} style={{ originY: 1 }}
        variants={{ hide: reduce ? { scaleY: 1 } : { scaleY: 0 }, show: { scaleY: 1 } }}
        transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }} />
    </motion.div>
  );
}
