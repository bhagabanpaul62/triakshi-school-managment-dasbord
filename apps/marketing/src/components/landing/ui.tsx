import Link from "next/link";
import type { ReactNode } from "react";

export type Tint = "green" | "cream" | "rose" | "sky" | "lilac" | "peach" | "mint" | "stone";

/** Literal class strings so Tailwind can see them. */
export const TINT: Record<Tint, string> = {
  green: "bg-t-green", cream: "bg-t-cream", rose: "bg-t-rose", sky: "bg-t-sky",
  lilac: "bg-t-lilac", peach: "bg-t-peach", mint: "bg-t-mint", stone: "bg-t-stone",
};

const BTN = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15.5px] font-semibold transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98]";
export const btnPrimary = `${BTN} bg-green text-white hover:bg-green-2`;
export const btnGhost = `${BTN} border border-line-strong bg-white text-ink hover:border-ink`;
export const btnOnGreen = `${BTN} bg-white text-green hover:bg-gold-soft`;
export const btnInk = `${BTN} bg-ink text-white hover:bg-green`;

const VARIANT = { primary: btnPrimary, ghost: btnGhost, onGreen: btnOnGreen, ink: btnInk } as const;

export function ButtonLink({ href, variant = "primary", children, className = "", onClick }: { href: string; variant?: keyof typeof VARIANT; children: ReactNode; className?: string; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} className={`${VARIANT[variant]} ${className}`}>{children}</Link>;
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wrap ${className}`}>{children}</div>;
}

/** A full-width band. `tone` picks the ground: paper (default), white, or the one deep green band. */
export function Section({ id, tone = "paper", className = "", children, labelledBy }: { id?: string; tone?: "paper" | "white" | "green"; className?: string; children: ReactNode; labelledBy?: string }) {
  const t = tone === "green" ? "on-green bg-green text-white" : tone === "white" ? "bg-white" : "";
  return (
    <section id={id} aria-labelledby={labelledBy} className={`py-14 md:py-16 ${t} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Kicker({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  return (
    <p className={`inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.1em] ${tone === "dark" ? "text-green-ink" : "text-green"}`}>
      <span aria-hidden className="h-[3px] w-5 rounded-full bg-gold" />
      {children}
    </p>
  );
}

/** The marigold highlighter swipe behind a word or two. */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="relative isolate inline-block whitespace-nowrap">
      <span aria-hidden className="swipe absolute inset-x-[-0.05em] bottom-[0.06em] -z-10 h-[0.32em] rounded-[3px] bg-gold" />
      {children}
    </span>
  );
}

export function SectionHeading({ kicker, title, sub, tone = "light", align = "left", id, className = "" }: { kicker?: string; title: ReactNode; sub?: ReactNode; tone?: "light" | "dark"; align?: "left" | "center"; id?: string; className?: string }) {
  return (
    <div className={`${align === "center" ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
      {kicker ? <Kicker tone={tone}>{kicker}</Kicker> : null}
      <h2 id={id} className={`h-display ${kicker ? "mt-4" : ""} text-[clamp(2rem,4.6vw,3.4rem)] ${tone === "dark" ? "text-white" : "text-ink"}`}>{title}</h2>
      {sub ? <p className={`text-pretty mt-4 max-w-2xl text-[17px] leading-relaxed md:text-[18px] ${align === "center" ? "mx-auto" : ""} ${tone === "dark" ? "text-green-ink" : "text-mute"}`}>{sub}</p> : null}
    </div>
  );
}

export function Card({ children, className = "", tint }: { children: ReactNode; className?: string; tint?: Tint }) {
  return <div className={`rounded-[28px] ${tint ? TINT[tint] : "bg-white"} ${className}`}>{children}</div>;
}

/** Small round icon well used on cards and lists. */
export function IconWell({ children, className = "bg-white text-green" }: { children: ReactNode; className?: string }) {
  return <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${className}`}>{children}</span>;
}
