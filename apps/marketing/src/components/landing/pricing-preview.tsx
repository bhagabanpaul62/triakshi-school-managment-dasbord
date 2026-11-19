import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import type { PublicPlan } from "@smw/onboarding";
import { PricingTable } from "../pricing-table";
import { Section, SectionHeading } from "./ui";

export function PricingPreview({ plans }: { plans: PublicPlan[] }) {
  return (
    <Section id="pricing" tone="white">
      <SectionHeading kicker="Pricing" title="One price, set by the size of your school." sub="Pick yearly or monthly. Every plan has all the modules and a 30-day free trial." />
      <div className="mt-8"><PricingTable plans={plans} /></div>
      <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-green underline-offset-4 hover:underline">See pricing and questions <IconArrowRight size={16} aria-hidden /></Link>
    </Section>
  );
}
