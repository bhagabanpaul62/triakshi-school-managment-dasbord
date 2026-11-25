/* eslint-disable @next/next/no-img-element -- school logos and photos are arbitrary https links, so next/image cannot optimise them */
import type { CSSProperties, ReactNode } from "react";
import { siteCss, type Theme } from "@smw/themes";
import { AdmissionForm, type EnquiryResult } from "./AdmissionForm";
import { ClickLoad } from "./ClickLoad";
import { ContactForm } from "./ContactForm";
import { AchieversBlock, DisclosureBlock, DocumentsBlock, Heading, Out, PeopleBlock, VideoBlock, Wrap, dateOnly, initials, type DisclosureProfile } from "./blocks";
import { HOME_SLUG, type NavItem, type Page, type Section, type SectionData, type SiteContent, type TemplateKey } from "./content";
import { TopicIcon } from "./icons";
import { SOCIALS, type SiteSettings } from "./settings";
import { mapsEmbed, mapsLink, noticeActive, whatsappLink } from "./site-utils";
import { SITE_CSS } from "./styles";

export { SiteMarkdown, Wrap } from "./blocks";

/** Public data the dynamic sections show. The app loads it; this package only draws it. */
export interface SiteData {
  news: { id: string; title: string; body: string; publishedAt: Date | string }[];
  events: { id: string; title: string; startsOn: string; location?: string | null; description?: string | null }[];
  staff: { id: string; name: string; subject?: string | null }[];
  /** Description of each uploaded photo by its address (Website, Media). Used when a photo has no caption of its own. */
  alt?: Record<string, string>;
  /** What each admission form offers, by section id: the school's classes, the sessions and the consent words. */
  forms?: Record<string, { classes: string[]; sessions: string[]; session: string; consentText: string }>;
}
export const EMPTY_DATA: SiteData = { news: [], events: [], staff: [] };

export interface SiteViewProps {
  school: { name: string; logoUrl?: string | null };
  template: TemplateKey;
  theme: Theme;
  content: SiteContent;
  /** "home" or a page slug (also marks the current menu item). */
  slug: string;
  data?: SiteData;
  /** Server action behind the admission form. */
  enquiry: (fd: FormData) => Promise<EnquiryResult>;
  /** Server action behind the question form; the admission action is used when absent. */
  question?: (fd: FormData) => Promise<EnquiryResult>;
  preview?: boolean;
  /** Notice bar, social links, phone buttons. Not versioned with the pages. */
  settings?: SiteSettings;
  /** The school's own details; rows of the disclosure fall back to them. */
  profile?: DisclosureProfile;
  /** Draw this page instead of the one `slug` names (news, events, privacy, not found). */
  page?: Page;
  /** Drawn inside the page after its sections (a notice's text, an event's details). */
  children?: ReactNode;
  /** One step between Home and the page title in the breadcrumb. */
  trail?: { label: string; href: string };
  /** Structured data; `<` is escaped here. */
  jsonLd?: unknown[];
  /** For the notice window; tests pass it. */
  now?: Date;
}

const hrefOf = (slug?: string) => (!slug ? "#" : slug === HOME_SLUG ? "/" : `/${slug}`);
/** next/font variables the app defines (see the (site) layout); the named family is the fallback. */
const FONT_VAR: Record<Theme["font"], string> = {
  Inter: "--font-inter", Poppins: "--font-poppins", Merriweather: "--font-merriweather", Nunito: "--font-nunito",
  "Playfair Display": "--font-playfair", "Source Sans 3": "--font-source",
};
const stack = (family: string, fallback: string) => `var(${FONT_VAR[family as Theme["font"]] ?? "--none"}, '${family}'), ${fallback}`;
/** The heading face of each design; minimal follows the school's own font. */
const HEAD_FONT: Record<TemplateKey, [string, string] | null> = {
  classic: ["Playfair Display", "Georgia, serif"], modern: ["Poppins", "system-ui, sans-serif"], minimal: null,
  campus: ["Source Sans 3", "system-ui, sans-serif"], playful: ["Nunito", "system-ui, sans-serif"],
};

const when = (d: Date | string) => (typeof d === "string" ? dateOnly(d) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);
const tel = (p: string) => `tel:${p.replace(/[^+\d]/g, "")}`;
const isLink = (s: string) => /^(https?:\/\/\S+|\/(?![/\\])\S*)$/i.test(s);
const SOCIAL_NAME = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn" } as const;

/** Plain paragraphs, sub-headings (## ) and bullet lists (- ); no raw HTML ever. */
function RichText({ body }: { body: string }) {
  return (
    <div className="st-prose">
      {body.split(/\n{2,}/).map((raw, i) => {
        const block = raw.trim();
        if (block.startsWith("## ")) return <h3 key={i}>{block.slice(3)}</h3>;
        const lines = block.split("\n").map((l) => l.trim());
        if (lines.every((l) => l.startsWith("- "))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>;
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

function Hero({ section, h1, alt }: { section: Extract<Section, { type: "hero" }>; h1: boolean; alt?: Record<string, string> }) {
  const H = h1 ? "h1" : "h2";
  const d = section.data;
  return (
    <section id={section.id} className={`st-section st-hero${d.imageUrl ? " st-has-image" : ""}`}>
      <div className="st-wrap">
        <div className="st-hero-copy">
          {d.eyebrow ? <p className="st-eyebrow">{d.eyebrow}</p> : null}
          <H>{d.heading}</H>
          {d.subheading ? <p className="st-sub">{d.subheading}</p> : null}
          {(d.ctaLabel && d.ctaHref) || (d.cta2Label && d.cta2Href) ? (
            <div className="st-actions">
              {d.ctaLabel && d.ctaHref ? <a className="st-btn" href={d.ctaHref}>{d.ctaLabel}</a> : null}
              {d.cta2Label && d.cta2Href ? <a className="st-btn st-ghost" href={d.cta2Href}>{d.cta2Label}</a> : null}
            </div>
          ) : null}
        </div>
        {d.imageUrl ? <div className="st-hero-media"><img src={d.imageUrl} alt={alt?.[d.imageUrl] ?? ""} loading="eager" /></div> : null}
      </div>
    </section>
  );
}

/** A map is a link until it is clicked: no third-party request before that. */
function MapEmbed({ address }: { address: string }) {
  return (
    <ClickLoad className="st-map" href={mapsLink(address)} embed={mapsEmbed(address)} title="Map of the school" label="Show the map"
      icon={<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>} />
  );
}

/** Visitors never see an empty "News" or "Events" band; the editor's draft preview keeps it, with a note. */
function EmptyNote({ preview, text }: { preview?: boolean; text: string }) {
  return preview ? <p className="st-empty">{text} (Visitors do not see this section until it has something to show.)</p> : null;
}

interface BlockProps { section: Section; data: SiteData; enquiry: SiteViewProps["enquiry"]; question: SiteViewProps["enquiry"]; preview?: boolean; phone?: string; slug: string; profile: DisclosureProfile; h1: boolean }
function Block({ section, data, enquiry, question, preview, phone, slug, profile, h1 }: BlockProps) {
  const { id } = section;
  switch (section.type) {
    case "hero": return <Hero section={section} h1={h1} alt={data.alt} />;
    case "rich_text": return <Wrap id={id} type="rich_text"><Heading text={section.data.heading} /><RichText body={section.data.body} /></Wrap>;
    case "stats": return (
      <Wrap id={id} type="stats"><div className="st-stats">{section.data.items.map((s, i) => <div className="st-stat" key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div></Wrap>
    );
    case "gallery": return (
      <Wrap id={id} type="gallery"><Heading text={section.data.heading} />
        <div className="st-gallery">{section.data.images.map((im, i) => (
          <figure key={i}><img src={im.url} alt={im.caption ?? data.alt?.[im.url] ?? ""} loading="lazy" />{im.caption ? <figcaption>{im.caption}</figcaption> : null}</figure>
        ))}</div>
      </Wrap>
    );
    case "news": {
      const items = data.news.slice(0, section.data.limit);
      if (!items.length && !preview) return null;
      return (
        <Wrap id={id} type="news"><Heading text={section.data.heading} />
          {items.length ? <div className="st-grid">{items.map((n) => <article className="st-card" key={n.id}><span className="st-meta">{when(n.publishedAt)}</span><h3><a className="st-card-link" href={`/news/${n.id}`}>{n.title}</a></h3><p>{clip(n.body, 160)}</p></article>)}</div>
            : <EmptyNote preview={preview} text="No public news yet." />}
          {items.length && slug !== "news" ? <p className="st-more-link"><a className="st-btn st-ghost" href="/news">All news and notices</a></p> : null}
        </Wrap>
      );
    }
    case "events": {
      const items = data.events.slice(0, section.data.limit);
      if (!items.length && !preview) return null;
      return (
        <Wrap id={id} type="events"><Heading text={section.data.heading} />
          {items.length ? <div className="st-grid">{items.map((e) => {
            const [day, month, year] = dateOnly(e.startsOn).split(" ");
            return (
              <article className="st-card st-event" key={e.id}>
                <time className="st-date" dateTime={e.startsOn.slice(0, 10)}><b>{day}</b><span>{month} {year}</span></time>
                <div><h3>{e.id.startsWith("holiday-") ? e.title : <a className="st-card-link" href={`/events/${e.id}`}>{e.title}</a>}</h3>{e.location ? <p>{e.location}</p> : e.description ? <p>{clip(e.description, 120)}</p> : null}</div>
              </article>
            );
          })}</div>
            : <EmptyNote preview={preview} text="No public events yet." />}
          {items.length && slug !== "events" ? <p className="st-more-link"><a className="st-btn st-ghost" href="/events">All events</a></p> : null}
        </Wrap>
      );
    }
    case "staff": {
      const items = data.staff.slice(0, section.data.limit);
      if (!items.length && !preview) return null;
      return (
        <Wrap id={id} type="staff"><Heading text={section.data.heading} />
          {items.length ? <div className="st-grid st-staffgrid">{items.map((s) => <article className="st-card" key={s.id}><div className="st-avatar" aria-hidden>{initials(s.name)}</div><h3>{s.name}</h3>{s.subject ? <p>{s.subject}</p> : null}</article>)}</div>
            : <EmptyNote preview={preview} text="No teachers to list yet." />}
        </Wrap>
      );
    }
    case "testimonials": return (
      <Wrap id={id} type="testimonials"><Heading text={section.data.heading} />
        <div className="st-grid">{section.data.items.map((t, i) => (
          <figure className="st-card" key={i} style={{ margin: 0 }}><blockquote style={{ margin: 0 }}><p className="st-quote">&ldquo;{t.quote}&rdquo;</p></blockquote>
            <figcaption className="st-who">{t.name}{t.role ? <small>{t.role}</small> : null}</figcaption></figure>
        ))}</div>
      </Wrap>
    );
    case "admission_form": return (
      <Wrap id={id} type="admission_form"><Heading text={section.data.heading} intro={section.data.intro} />
        <AdmissionForm action={enquiry} classes={data.forms?.[section.id]?.classes ?? section.data.classes} sessions={data.forms?.[section.id]?.sessions} session={data.forms?.[section.id]?.session} consentText={data.forms?.[section.id]?.consentText} phone={phone} />
      </Wrap>
    );
    case "contact": {
      const d: SectionData<"contact"> = section.data;
      return (
        <Wrap id={id} type="contact"><Heading text={d.heading} />
          <div className="st-contact">
            <dl>
              <div><dt>Address</dt><dd>{d.address}</dd></div>
              {d.phone ? <div><dt>Phone</dt><dd><a href={tel(d.phone)}>{d.phone}</a></dd></div> : null}
              {d.email ? <div><dt>Email</dt><dd><a href={`mailto:${d.email}`}>{d.email}</a></dd></div> : null}
              {d.hours ? <div><dt>Office hours</dt><dd>{d.hours}</dd></div> : null}
              <div><a className="st-btn st-ghost" href={mapsLink(d.address)} target="_blank" rel="noopener noreferrer">Get directions<span className="st-sr"> (opens in a new tab)</span></a></div>
            </dl>
            <MapEmbed address={d.address} />
          </div>
        </Wrap>
      );
    }
    case "features": return (
      <Wrap id={id} type="features"><Heading text={section.data.heading} intro={section.data.intro} />
        <div className="st-features">{section.data.items.map((f, i) => (
          <article className="st-feature" key={i}><span className="st-icon"><TopicIcon title={f.title} /></span><h3>{f.title}</h3>{f.text ? <p>{f.text}</p> : null}</article>
        ))}</div>
      </Wrap>
    );
    case "steps": return (
      <Wrap id={id} type="steps"><Heading text={section.data.heading} intro={section.data.intro} />
        <ol className="st-steps">{section.data.items.map((s, i) => <li className="st-step" key={i}><h3>{s.title}</h3>{s.text ? <p>{s.text}</p> : null}</li>)}</ol>
      </Wrap>
    );
    case "image_text": {
      const d = section.data;
      return (
        <Wrap id={id} type="image_text">
          <div className={`st-split${d.imageUrl ? " st-has-image" : ""}${d.side === "left" ? " st-left" : ""}`}>
            <div>
              <Heading text={d.heading} /><RichText body={d.body} />
              {d.name || d.role ? <p className="st-sign">{d.name}{d.role ? <small>{d.role}</small> : null}</p> : null}
            </div>
            {d.imageUrl ? <div className="st-split-media"><img src={d.imageUrl} alt={d.name ?? data.alt?.[d.imageUrl] ?? ""} loading="lazy" /></div> : null}
          </div>
        </Wrap>
      );
    }
    case "faq": return (
      <Wrap id={id} type="faq"><Heading text={section.data.heading} />
        <div className="st-faq">{section.data.items.map((f, i) => <details key={i}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
      </Wrap>
    );
    case "table": {
      const d = section.data;
      return (
        <Wrap id={id} type="table"><Heading text={d.heading} intro={d.intro} />
          <div className="st-table-wrap" role="region" aria-label={d.heading ?? "Table"} tabIndex={0}>
            <table className="st-table">
              <thead><tr>{d.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
              <tbody>{d.rows.map((r, i) => (
                <tr key={i}>{d.columns.map((_, j) => {
                  const c = r[j] ?? "";
                  return <td key={j}>{isLink(c) ? <Out className="st-view" href={c} label={`View ${r[0] ?? "document"}`}>View</Out> : c}</td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
          {d.note ? <p className="st-note">{d.note}</p> : null}
        </Wrap>
      );
    }
    case "links": return (
      <Wrap id={id} type="links"><Heading text={section.data.heading} intro={section.data.intro} />
        <ul className="st-links">{section.data.items.map((l, i) => <li key={i}><Out href={l.href}>{l.label}</Out></li>)}</ul>
      </Wrap>
    );
    case "video": return <VideoBlock section={section} />;
    case "documents": return <DocumentsBlock section={section} />;
    case "people": return <PeopleBlock section={section} />;
    case "achievers": return <AchieversBlock section={section} />;
    case "disclosure": return <DisclosureBlock section={section} profile={profile} />;
    case "contact_form": return (
      <Wrap id={id} type="contact_form"><Heading text={section.data.heading} intro={section.data.intro} />
        <ContactForm action={question} phone={phone} />
      </Wrap>
    );
    case "cta": return (
      <section id={id} className="st-section st-cta"><div className="st-wrap"><div className="st-cta-box">
        <h2>{section.data.heading}</h2>{section.data.text ? <p>{section.data.text}</p> : null}
        <a className="st-btn" href={section.data.ctaHref}>{section.data.ctaLabel}</a>
      </div></div></section>
    );
  }
}


const ico = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const PhoneIcon = () => <svg {...ico}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>;
const ChatIcon = () => <svg {...ico}><path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.1-4.9A8 8 0 1 1 21 12z" /></svg>;
const PinIcon = () => <svg {...ico}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>;
const Chevron = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>;

type Leaf = { label: string; slug?: string; href?: string };
const leafHref = (n: Leaf) => n.href ?? (n.slug ? hrefOf(n.slug) : undefined);

function NavLink({ n, slug }: { n: Leaf; slug: string }) {
  const href = leafHref(n);
  if (!href) return <span className="st-dd-label">{n.label}</span>;
  const ext = !href.startsWith("/");
  return (
    <a href={href} aria-current={n.slug === slug ? "page" : undefined} className={slug && n.slug === "admissions" && n.slug !== slug ? "st-apply" : undefined} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {n.label}{ext ? <span className="st-sr"> (opens in a new tab)</span> : null}
    </a>
  );
}

/** One public page of a school site, in the school's template and theme. */
export function SiteView({ school, template, theme, content, slug, data = EMPTY_DATA, enquiry, question, preview, settings, profile = {}, page: pageProp, children, trail, jsonLd, now }: SiteViewProps) {
  const page: Page | undefined = pageProp ?? content.pages.find((p) => p.slug === slug);
  if (!page || (page.hidden && !preview && !pageProp)) return null;
  const head = HEAD_FONT[template];
  const vars = { "--st-body": stack(theme.font, "system-ui, sans-serif"), "--st-head": head ? stack(head[0], head[1]) : stack(theme.font, "system-ui, sans-serif") } as CSSProperties;
  const open = (s?: string) => !s || s === HOME_SLUG || content.pages.some((p) => p.slug === s && !p.hidden);
  // A menu entry whose page is hidden or gone is left out, and a group with nothing left in it too.
  const nav = content.nav.flatMap((n): NavItem[] => {
    const kids = n.children?.filter((c) => open(c.slug));
    if (n.slug && !open(n.slug)) return [];
    if (!n.slug && !n.href && !kids?.length) return [];
    return [{ ...n, children: kids?.length ? kids : undefined }];
  });
  const hasApply = nav.some((n) => n.slug === "admissions");
  const sections = page.sections.filter((s) => !s.hidden);
  // A hidden page is not part of the site, so its contact details are not in the header or footer either (a preview of that very page excepted).
  const contact = content.pages.filter((p) => !p.hidden || p.slug === page.slug).flatMap((p) => p.sections).find((s): s is Extract<Section, { type: "contact" }> => s.type === "contact" && !s.hidden)?.data;
  const notice = noticeActive(settings?.notice, now) ? settings!.notice! : null;
  const call = settings?.callNumber?.trim();
  const wa = settings?.whatsapp ? whatsappLink(settings.whatsapp) : null;
  const dir = settings?.showDirections && contact?.address ? mapsLink(contact.address) : null;
  const bar = !!(call || wa || dir);
  const social = SOCIALS.flatMap((k) => (settings?.social[k] ? [{ k, href: settings.social[k]! }] : []));
  const firstHero = sections.findIndex((s) => s.type === "hero");
  // Inner pages open with a title banner unless the school put its own hero first.
  const banner = slug !== HOME_SLUG && sections[0]?.type !== "hero";
  const h1Hero = banner ? -1 : firstHero;
  const noH1 = !banner && firstHero < 0;
  const flat = nav.flatMap((n) => [...(n.slug || n.href ? [n] : []), ...(n.children ?? [])]);
  const props = { data, enquiry, question: question ?? enquiry, preview, phone: contact?.phone, slug, profile };
  return (
    <div className={`st-root${bar ? " st-has-bar" : ""}`} data-template={template} style={vars}>
      <style dangerouslySetInnerHTML={{ __html: `${siteCss(theme)}${SITE_CSS}` }} />
      {jsonLd?.map((o, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(o).replace(/</g, "\\u003c") }} />)}
      <a className="st-skip" href="#st-main">Skip to content</a>
      {preview ? <div className="st-preview" role="status">Draft preview. Visitors still see the published site.</div> : null}
      {notice ? (
        <div className={`st-notice st-tone-${notice.tone}`} role="region" aria-label="School notice"><div className="st-wrap">
          {notice.href ? <a href={notice.href} {...(notice.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{notice.text}<span aria-hidden> &rarr;</span></a> : <span>{notice.text}</span>}
        </div></div>
      ) : null}
      {contact?.phone || contact?.email ? (
        <div className="st-topbar"><div className="st-wrap">
          <span>{contact.hours ?? ""}</span>
          <span>{contact.phone ? <a href={tel(contact.phone)}>{contact.phone}</a> : null}{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}</span>
        </div></div>
      ) : null}
      <header className="st-header">
        <div className="st-wrap">
          <a className="st-brand" href="/">{school.logoUrl ? <img src={school.logoUrl} alt="" /> : null}<span>{school.name}</span></a>
          <nav className="st-nav" aria-label="Main">
            <ul>
              <li><NavLink n={{ label: "Home", slug: HOME_SLUG }} slug={slug} /></li>
              {nav.map((n, i) => n.children ? (
                <li className="st-dd" key={i}>
                  {leafHref(n) ? <NavLink n={n} slug={slug} /> : <span className="st-dd-label" tabIndex={0} aria-haspopup="true">{n.label}</span>}
                  <span className="st-chev" aria-hidden><Chevron /></span>
                  <ul className="st-subnav">{n.children.map((c, j) => <li key={j}><NavLink n={c} slug={slug} /></li>)}</ul>
                </li>
              ) : <li key={i}><NavLink n={n} slug={slug} /></li>)}
            </ul>
          </nav>
          <details className="st-menu">
            <summary><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>Menu</summary>
            <nav aria-label="Main, mobile">
              <ul>
                <li><NavLink n={{ label: "Home", slug: HOME_SLUG }} slug={slug} /></li>
                {nav.map((n, i) => (
                  <li key={i}>
                    <NavLink n={n} slug={slug} />
                    {n.children ? <ul className="st-nest">{n.children.map((c, j) => <li key={j}><NavLink n={c} slug={slug} /></li>)}</ul> : null}
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>
      </header>
      <main className="st-main" id="st-main">
        {banner ? (
          <div className="st-banner"><div className="st-wrap">
            <p className="st-crumb"><a href="/">Home</a><span aria-hidden>/</span>{trail ? <><a href={trail.href}>{trail.label}</a><span aria-hidden>/</span></> : null}<span>{page.title}</span></p>
            <h1>{page.title}</h1>
            {page.intro ? <p className="st-sub">{page.intro}</p> : null}
          </div></div>
        ) : null}
        {noH1 ? <h1 className="st-sr">{school.name}</h1> : null}
        {sections.map((s, i) => <Block key={s.id} section={s} h1={i === h1Hero} {...props} />)}
        {children}
        {!sections.length && !children ? <section className="st-section"><div className="st-wrap"><p className="st-empty">This page is being written. Please check back soon.</p></div></section> : null}
      </main>
      <footer className="st-footer">
        <div className="st-wrap st-foot">
          <div className="st-foot-brand">
            <b>{school.name}</b>
            {contact ? <><span>{contact.address}</span>{contact.phone ? <a href={tel(contact.phone)}>{contact.phone}</a> : null}{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}</> : null}
          </div>
          <nav aria-label="Pages"><h2>Explore</h2><ul><li><NavLink n={{ label: "Home", slug: HOME_SLUG }} slug="" /></li>{flat.map((n, i) => <li key={i}><NavLink n={n} slug="" /></li>)}</ul></nav>
          {content.footer.links.length ? <nav aria-label="Footer"><h2>Quick links</h2><ul>{content.footer.links.map((l, i) => <li key={i}><Out href={l.href}>{l.label}</Out></li>)}</ul></nav> : null}
          {(content.footer.columns ?? []).filter((c) => c.links.length).map((c, ci) => <nav key={`c${ci}`} aria-label={c.title}><h2>{c.title}</h2><ul>{c.links.map((l, i) => <li key={i}><Out href={l.href}>{l.label}</Out></li>)}</ul></nav>)}
          {social.length ? <nav aria-label="Social media"><h2>Follow us</h2><ul>{social.map((x) => <li key={x.k}><Out href={x.href}>{SOCIAL_NAME[x.k]}</Out></li>)}</ul></nav> : null}
        </div>
        <div className="st-wrap st-foot-bar"><span>{content.footer.text ?? school.name}</span><a href="/privacy">Privacy notice</a></div>
      </footer>
      {bar ? (
        <div className="st-bar" role="group" aria-label="Contact the school">
          {call ? <a href={tel(call)}><PhoneIcon />Call</a> : null}
          {wa ? <a href={wa} target="_blank" rel="noopener noreferrer"><ChatIcon />WhatsApp<span className="st-sr"> (opens in a new tab)</span></a> : null}
          {dir ? <a href={dir} target="_blank" rel="noopener noreferrer"><PinIcon />Directions<span className="st-sr"> (opens in a new tab)</span></a> : null}
        </div>
      ) : null}
      {hasApply && slug !== "admissions" ? <a className="st-sticky-apply st-btn" href="/admissions">Apply for admission</a> : null}
    </div>
  );
}
