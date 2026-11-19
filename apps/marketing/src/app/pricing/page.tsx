import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight, IconCheck } from "@tabler/icons-react";
import { FaqSection } from "@/components/landing/faq-section";
import { GROUPS, MODULE_COUNT } from "@/components/landing/modules-data";
import { Kicker, Section } from "@/components/landing/ui";
import { PricingTable } from "@/components/pricing-table";
import { loadPlans } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pricing", description: "Triakshi plans by school size, yearly or monthly, in rupees plus 18% GST. 30-day free trial." };

export default async function PricingPage() {
  const plans = await loadPlans();
  return (
    <>
      <Section className="!pb-6 md:!pb-10">
        <Kicker>Pricing</Kicker>
        <h1 className="h-display mt-4 max-w-3xl text-[clamp(2.4rem,5.4vw,3.8rem)]">Priced by the size of your school.</h1>
        <p className="text-pretty mt-4 max-w-2xl text-[17px] leading-relaxed text-mute md:text-[18px]">Pick yearly or monthly. Every plan has every module and starts with a 30-day free trial.</p>
        <div className="mt-9"><PricingTable plans={plans} /></div>
        <div className="mt-10 rounded-[28px] bg-white p-6 md:p-8">
          <h2 className="h-display text-[24px] md:text-[28px]">Every plan includes all {MODULE_COUNT} modules</h2>
          <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {GROUPS.map((g) => (
              <li key={g.name} className="flex gap-2.5 text-[15.5px] leading-snug">
                <IconCheck size={18} stroke={2.6} aria-hidden className="mt-0.5 shrink-0 text-green" />
                <span><span className="font-semibold">{g.name}</span><span className="text-mute">: {g.mods.map((m) => m.name.toLowerCase()).join(", ")}</span></span>
              </li>
            ))}
          </ul>
          <Link href="/#modules" className="mt-5 inline-flex min-h-11 items-center gap-2 text-[15.5px] font-semibold text-green underline-offset-4 hover:underline">What each module does <IconArrowRight size={16} aria-hidden /></Link>
        </div>
      </Section>
      <FaqSection />
    </>
  );
}
