import { ClosingCta } from "@/components/landing/closing-cta";
import { Compare } from "@/components/landing/compare";
import { FaqSection } from "@/components/landing/faq-section";
import { FeatureTour } from "@/components/landing/feature-tour";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Modules } from "@/components/landing/modules";
import { ParentBand } from "@/components/landing/parent-band";
import { PricingPreview } from "@/components/landing/pricing-preview";
import { ProofStrip } from "@/components/landing/proof-strip";
import { Trust } from "@/components/landing/trust";
import { WebsiteSection } from "@/components/landing/website-section";
import { loadPlans } from "@/lib/site";

export const dynamic = "force-dynamic"; // prices come from the plans table

export default async function HomePage() {
  const plans = await loadPlans();
  return (
    <>
      <Hero />
      <ProofStrip />
      <FeatureTour />
      <Modules />
      <HowItWorks />
      <ParentBand />
      <WebsiteSection />
      <Compare />
      <Trust />
      <PricingPreview plans={plans} />
      <FaqSection />
      <ClosingCta />
    </>
  );
}
