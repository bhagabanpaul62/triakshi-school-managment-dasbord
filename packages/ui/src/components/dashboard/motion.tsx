"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// One easing and one entrance for the whole dashboard, so every surface arrives the same way.
export const EASE = [0.22, 1, 0.36, 1] as const;

export const rise = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE } },
};

export const stagger = (gap = 0.04, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

const withGrouping = (n: number, decimals: number, grouped: boolean) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });

/**
 * Counts the first number inside a pre-formatted string ("₹1.9M", "16", "45 days") up from zero, keeping
 * the prefix/suffix. It always lands on the exact original string, so formatting (e.g. Indian grouping)
 * is never altered by the animation.
 */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion();
  const match = NUMBER.exec(value);
  const [text, setText] = useState(value);
  const done = useRef(false);

  useEffect(() => {
    if (!match || reduce || done.current) {
      setText(value);
      return;
    }
    done.current = true;
    const raw = match[0];
    const target = Number(raw.replace(/,/g, ""));
    const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
    const grouped = raw.includes(",");
    const before = value.slice(0, match.index);
    const after = value.slice(match.index + raw.length);
    const controls = animate(0, target, {
      duration: 0.7,
      ease: EASE,
      onUpdate: (v) => setText(`${before}${withGrouping(v, decimals, grouped)}${after}`),
      onComplete: () => setText(value),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new value restarts the count
  }, [value]);

  return <span className={className}>{text}</span>;
}
