import Link from "next/link";
import { Container } from "./landing/ui";
import { Logo } from "./landing/nav";
export { SiteHeader } from "./landing/nav";

const COLS = [
  { title: "Product", links: [["/#tour", "What it looks like"], ["/#modules", "All modules"], ["/#how", "How it works"], ["/pricing", "Pricing"]] },
  { title: "Get started", links: [["/signup", "Start free trial"], ["/#faq", "Questions"], ["/#trust", "Trust and security"]] },
  { title: "Legal", links: [["/privacy", "Privacy"], ["/terms", "Terms"]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white pb-[max(32px,env(safe-area-inset-bottom))] pt-12 md:pt-16">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-[1.5fr_1fr_1fr_0.8fr] md:gap-10">
        <div className="col-span-2 md:col-span-1">
          <Logo />
          <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-mute">School management for Indian schools. One dashboard for the office, teachers, students and parents.</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-mute">{c.title}</p>
            <ul className="mt-2">
              {c.links.map(([href, label]) => (
                <li key={href}><Link href={href} className="flex min-h-11 items-center text-[15.5px] underline-offset-4 hover:underline md:min-h-9">{label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container>
        <p className="mt-10 flex flex-col gap-1 border-t border-line pt-6 text-[13.5px] text-mute sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Triakshi. Made for schools in India.</span><span>Prices exclude 18% GST.</span>
        </p>
      </Container>
    </footer>
  );
}
