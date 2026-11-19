// Shared motion presets. Plain objects, so server and client files can both import them.
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade-and-lift once when scrolled into view. Empty for people who prefer reduced motion. */
export const rise = (reduce: boolean | null, delay = 0, y = 18) =>
  reduce ? {} : {
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "0px 0px -8% 0px" },
    transition: { duration: 0.5, delay, ease: EASE },
  };
