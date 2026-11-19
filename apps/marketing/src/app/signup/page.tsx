import type { Metadata } from "next";
import { IconCircleCheck } from "@tabler/icons-react";
import { env } from "@smw/config";
import { Container, Kicker } from "@/components/landing/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start your free trial", description: "Open your school's dashboard in five minutes. 30 days free, no card." };

export default function SignupPage() {
  const e = env();
  return (
    <Container className="grid gap-12 py-12 md:py-20 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <Kicker>Free for 30 days</Kicker>
        <h1 className="h-display mt-4 text-[clamp(2.2rem,5vw,3.6rem)]">Open your school&rsquo;s dashboard.</h1>
        <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-mute">Four short steps, about two minutes. No card, and your data is yours to export at any time.</p>
        <ol className="mt-8 flex max-w-sm flex-col gap-4 text-[15px]">
          {[["Today", "tell us about your school and confirm your email."], ["Within a business day", "our team reviews and approves it."], ["Then", "your 30-day trial starts."]].map(([k, v]) => (
            <li key={k} className="flex gap-3"><IconCircleCheck size={22} aria-hidden className="mt-0.5 shrink-0 text-green" /><span><span className="font-semibold">{k}:</span> <span className="text-mute">{v}</span></span></li>
          ))}
        </ol>
      </div>
      <SignupForm rootDomain={e.ROOT_DOMAIN} />
    </Container>
  );
}
