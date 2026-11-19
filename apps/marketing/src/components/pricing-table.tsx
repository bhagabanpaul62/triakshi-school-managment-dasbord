"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicPlan } from "@smw/onboarding";
import { rupees } from "@/lib/format";

const BTN = "inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong bg-white px-5 text-sm font-semibold transition-colors duration-200 hover:border-green hover:bg-green hover:text-white";
const FIT = "rounded-full bg-gold px-2.5 py-1 align-middle text-[11px] font-semibold text-ink";

export function PricingTable({ plans }: { plans: PublicPlan[] }) {
  const [annual, setAnnual] = useState(true);
  const [size, setSize] = useState("");
  const n = Number(size);
  // The smallest plan that holds the school; plans arrive ordered by size.
  const fit = n >= 1 ? [...plans].sort((a, b) => a.studentCap - b.studentCap).find((p) => p.studentCap >= n)?.key ?? "enterprise" : null;
  const top = plans.reduce((m, p) => Math.max(m, p.priceMonthlyPaise > 0 ? Math.round((1 - p.priceAnnualPaise / (p.priceMonthlyPaise * 12)) * 100) : 0), 0);
  const nf = new Intl.NumberFormat("en-IN");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-white p-1 text-sm">
          {([[true, "Yearly"], [false, "Monthly"]] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={annual === v} onClick={() => setAnnual(v)}
              className={`min-h-10 rounded-full px-5 font-semibold transition-colors duration-200 ${annual === v ? "bg-green text-white" : "text-mute hover:text-ink"}`}>{label}{v && top > 0 ? <span className={`ml-2 text-xs ${annual === v ? "text-gold" : "text-ok"}`}>Save {top}%</span> : null}</button>
          ))}
        </div>
        {plans.length > 0 && <label className="flex items-center gap-3 text-sm text-mute">
          How many students?
          <input value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="450" aria-label="Number of students in your school"
            className="h-11 w-28 rounded-full border border-line-strong bg-white px-4 text-[16px] text-ink outline-none focus:border-green" />
        </label>}
      </div>

      {plans.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-line bg-white p-6 text-mute">Prices are not loading right now. <Link href="/signup" className="font-semibold text-green underline underline-offset-4">Start a free trial</Link> and you will see them in your account, or ask us for a quote.</p>
      ) : (
        <ul className="mt-8 grid gap-3">
          {plans.map((p) => {
            const price = annual ? p.priceAnnualPaise : p.priceMonthlyPaise;
            return (
              <li key={p.key} className={`grid items-center gap-4 rounded-3xl border bg-white p-5 md:grid-cols-[1.1fr_1fr_1.2fr_auto] md:p-6 ${fit === p.key ? "border-green ring-1 ring-green" : "border-line"}`}>
                <h3 className="h-display text-[26px]">{p.name}{fit === p.key ? <span className={`ml-3 ${FIT}`}>Fits {nf.format(n)} students</span> : null}</h3>
                <p className="text-mute">Up to <span className="font-semibold tabular-nums text-ink">{nf.format(p.studentCap)}</span> students</p>
                <p>
                  <span className="text-3xl font-semibold tabular-nums tracking-tight">{rupees(price)}</span>
                  <span className="ml-1.5 text-sm text-mute">{annual ? "per year" : "per month"} + 18% GST</span>
                  {annual && p.priceMonthlyPaise > 0 ? <span className="mt-1 block text-xs text-mute">About {rupees(Math.round(p.priceAnnualPaise / 12))} a month</span> : null}
                </p>
                <Link href="/signup" className={BTN}>Start free trial</Link>
              </li>
            );
          })}
          <li className={`grid items-center gap-4 rounded-3xl border p-5 md:grid-cols-[1.1fr_2.2fr_auto] md:p-6 ${fit === "enterprise" ? "border-green bg-white" : "border-line bg-t-cream"}`}>
            <h3 className="h-display text-[26px]">Enterprise{fit === "enterprise" ? <span className={`ml-3 ${FIT}`}>Best for your size</span> : null}</h3>
            <p className="text-mute">More than 3,000 students, a chain of schools, or a rollout that needs a plan of its own. Tell us in the signup and we will come back with a quote.</p>
            <Link href="/signup" className={BTN}>Talk to us</Link>
          </li>
        </ul>
      )}
      <p className="mt-5 text-sm text-mute">Every plan starts with a 30-day free trial. No card to start. Prices exclude GST; you get a GST invoice for every payment.</p>
    </div>
  );
}
