/** Small pure helpers of the public site: video links, the notice window, phone links, sizes. No React. */
import type { SiteSettings } from "./settings";

export interface VideoEmbed { provider: "youtube" | "vimeo"; /** Open on the provider's own page. */ watch: string; /** The privacy player, loaded only after a click. */ embed: string }

/** The privacy-friendly player for a YouTube or Vimeo link, or null for any other link. */
export function videoEmbed(url: string): VideoEmbed | null {
  const yt = /^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/i.exec(url);
  if (yt) return { provider: "youtube", watch: `https://www.youtube.com/watch?v=${yt[1]}`, embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0` };
  const vi = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/i.exec(url);
  if (vi) return { provider: "vimeo", watch: `https://vimeo.com/${vi[1]}`, embed: `https://player.vimeo.com/video/${vi[1]}?dnt=1&autoplay=1` };
  return null;
}

/** Today in India as YYYY-MM-DD. */
export const istDay = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The notice bar shows from its first day to its last day inclusive, by Indian days; empty text never shows. */
export function noticeActive(n: SiteSettings["notice"], now: Date = new Date()): n is NonNullable<SiteSettings["notice"]> {
  if (!n?.text.trim()) return false;
  const today = istDay(now);
  return (!n.from || today >= n.from) && (!n.until || today <= n.until);
}

/** wa.me link for an Indian mobile number (10 digits gets 91 in front). */
export function whatsappLink(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}

export const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
export const mapsEmbed = (address: string) => `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;

/** "340 KB", "2.4 MB". */
export function fileSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const drop = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));

/** schema.org School for search engines. Only what the school has filled in. */
export function schoolLd(i: { name: string; url: string; logo?: string | null; phone?: string | null; email?: string | null; address?: { street?: string | null; city?: string | null; state?: string | null; pin?: string | null }; sameAs?: string[] }) {
  const a = i.address;
  return drop({
    "@context": "https://schema.org", "@type": "School", name: i.name, url: i.url, logo: i.logo, telephone: i.phone, email: i.email, sameAs: i.sameAs,
    address: a && (a.street || a.city) ? drop({ "@type": "PostalAddress", streetAddress: a.street, addressLocality: a.city, addressRegion: a.state, postalCode: a.pin, addressCountry: "IN" }) : undefined,
  });
}

export const breadcrumbLd = (items: { name: string; url: string }[]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
});

/** The short privacy notice of a school's website: what the forms collect, why, who sees it. Markdown subset. */
export function privacyText(s: { name: string; email?: string | null; phone?: string | null; address?: string | null }): string {
  const reach = [s.email ? `email ${s.email}` : "", s.phone ? `call ${s.phone}` : "", s.address ? `visit ${s.address}` : ""].filter(Boolean);
  return [
    "## Who we are",
    `${s.name} runs this website and decides what is done with the details you send through it.`,
    "## What we collect",
    "When you send an admission enquiry we ask for your child's name, date of birth, gender, the class you want and the school your child attends now. We also ask for your name, your relation to the child, your phone number, and optionally another phone number, your email, your address and a message. When you send a question we ask for your name, phone number and the question.",
    "We keep a record that you agreed to this notice when you sent the form.",
    "## Why we use it",
    "To call you back about admission or to answer your question, and to tell you about the next step. We do not use it for advertising and we do not sell it.",
    "## Who sees it",
    "Only the school staff who handle admissions and enquiries, and the software service that hosts this website for the school.",
    "## How long we keep it",
    "While your enquiry is open, and after that only for the time the school keeps its admission records. Ask the school office for the current period.",
    "## Cookies and tracking",
    "This website sets no cookies and loads no scripts from other companies. Maps and videos load from their own services only after you press them. We count how many times each page is opened per day, without storing who opened it.",
    "## Your choices",
    `You can ask to see, correct or delete what we hold about you or your child${reach.length ? `. To do so, ${reach.join(", or ")}.` : ", by contacting the school office."}`,
  ].join("\n\n");
}

/** The first picture written into a notice or event text (`![words](address)`), when it is one of ours or a full https link. */
export function firstMarkdownImage(md: string | null | undefined): string | undefined {
  return md?.match(/!\[[^\]]*\]\(\s*((?:https:\/\/|\/api\/files\/)[^)\s]+)/i)?.[1];
}

/** The picture a shared page shows: the item's own, else the home hero, else the logo. */
export function shareImage(o: { item?: string | null; page?: string | null; hero?: string | null; logo?: string | null }): string | undefined {
  return o.item || o.page || o.hero || o.logo || undefined;
}
