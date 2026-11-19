import { Faq } from "../faq";
import { Section, SectionHeading } from "./ui";

export function FaqSection() {
  return (
    <Section id="faq" labelledBy="faq-title">
      <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-14">
        <SectionHeading id="faq-title" kicker="Questions" title="Before you sign up." sub="If your question is not here, ask us when you sign up and we will reply by email." className="lg:sticky lg:top-28 lg:self-start" />
        <Faq />
      </div>
    </Section>
  );
}
