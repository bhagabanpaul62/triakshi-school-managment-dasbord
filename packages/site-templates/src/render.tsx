/* eslint-disable @next/next/no-img-element -- school logos and photos are arbitrary https links, so next/image cannot optimise them */
import type { CSSProperties, ReactNode } from "react";
import { siteCss, type Theme } from "@smw/themes";
import { AdmissionForm, type EnquiryResult } from "./AdmissionForm";
import { HOME_SLUG, type Page, type Section, type SectionData, type SiteContent, type TemplateKey } from "./content";
import { TopicIcon } from "./icons";
import { SITE_CSS } from "./styles";

/** Public data the dynamic sections show. The app loads it; this package only draws it. */
export interface SiteData {
  news: { id: string; title: string; body: string; publishedAt: Date | string }[];
  events: { id: string; title: string; startsOn: string; location?: string | null; description?: string | null }[];
  staff: { id: string; name: string; subject?: string | null }[];
}
export const EMPTY_DATA: SiteData = { news: [], events: [], staff: [] };

export interface SiteViewProps {
  school: { name: string; logoUrl?: string | null };
  template: TemplateKey;
  theme: Theme;
  content: SiteContent;
  /** "home" or a page slug. */
  slug: string;
  data?: SiteData;
  /** Server action behind the admission form. */
  enquiry: (fd: FormData) => Promise<EnquiryResult>;
  preview?: boolean;
}

const hrefOf = (slug: string) => (slug === HOME_SLUG ? "/" : `/${slug}`);
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

const dateOnly = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (d: Date | string) => (typeof d === "string" ? dateOnly(d) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);
const tel = (p: string) => `tel:${p.replace(/[^+\d]/g, "")}`;
const isLink = (s: string) => /^(https?:\/\/\S+|\/(?![/\\])\S*)$/i.test(s);

function Wrap({ id, type, children, className = "" }: { id: string; type: string; children: ReactNode; className?: string }) {
  // "st-sec-": the inner grids own the plain names (st-contact, st-faq...), so the section must not share them.
  return <section id={id} className={`st-section st-sec-${type} ${className}`.trim()}><div className="st-wrap">{children}</div></section>;
}
const Heading = ({ text, intro }: { text?: string; intro?: string }) => (text || intro ? <div className="st-head">{text ? <h2>{text}</h2> : null}{intro ? <p>{intro}</p> : null}</div> : null);

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

function Hero({ section }: { section: Extract<Section, { type: "hero" }> }) {
  const d = section.data;
  return (
    <section id={section.id} className={`st-section st-hero${d.imageUrl ? " st-has-image" : ""}`}>
      <div className="st-wrap">
        <div className="st-hero-copy">
          {d.eyebrow ? <p className="st-eyebrow">{d.eyebrow}</p> : null}
          <h1>{d.heading}</h1>
          {d.subheading ? <p className="st-sub">{d.subheading}</p> : null}
          {(d.ctaLabel && d.ctaHref) || (d.cta2Label && d.cta2Href) ? (
            <div className="st-actions">
              {d.ctaLabel && d.ctaHref ? <a className="st-btn" href={d.ctaHref}>{d.ctaLabel}</a> : null}
              {d.cta2Label && d.cta2Href ? <a className="st-btn st-ghost" href={d.cta2Href}>{d.cta2Label}</a> : null}
            </div>
          ) : null}
        </div>
        {d.imageUrl ? <div className="st-hero-media"><img src={d.imageUrl} alt="" loading="eager" /></div> : null}
      </div>
    </section>
  );
}

function MapEmbed({ address }: { address: string }) {
  return <iframe className="st-map" title="Map of the school" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`} />;
}

/** Visitors never see an empty "News" or "Events" band; the editor's draft preview keeps it, with a note. */
function EmptyNote({ preview, text }: { preview?: boolean; text: string }) {
  return preview ? <p className="st-empty">{text} (Visitors do not see this section until it has something to show.)</p> : null;
}

function Block({ section, data, enquiry, preview, phone }: { section: Section; data: SiteData; enquiry: SiteViewProps["enquiry"]; preview?: boolean; phone?: string }) {
  const { id } = section;
  switch (section.type) {
    case "hero": return <Hero section={section} />;
    case "rich_text": return <Wrap id={id} type="rich_text"><Heading text={section.data.heading} /><RichText body={section.data.body} /></Wrap>;
    case "stats": return (
      <Wrap id={id} type="stats"><div className="st-stats">{section.data.items.map((s, i) => <div className="st-stat" key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div></Wrap>
    );
    case "gallery": return (
      <Wrap id={id} type="gallery"><Heading text={section.data.heading} />
        <div className="st-gallery">{section.data.images.map((im, i) => (
          <figure key={i}><img src={im.url} alt={im.caption ?? ""} loading="lazy" />{im.caption ? <figcaption>{im.caption}</figcaption> : null}</figure>
        ))}</div>
      </Wrap>
    );
    case "news": {
      const items = data.news.slice(0, section.data.limit);
      if (!items.length && !preview) return null;
      return (
        <Wrap id={id} type="news"><Heading text={section.data.heading} />
          {items.length ? <div className="st-grid">{items.map((n) => <article className="st-card" key={n.id}><span className="st-meta">{when(n.publishedAt)}</span><h3>{n.title}</h3><p>{clip(n.body, 160)}</p></article>)}</div>
            : <EmptyNote preview={preview} text="No public news yet." />}
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
                <div><h3>{e.title}</h3>{e.location ? <p>{e.location}</p> : e.description ? <p>{clip(e.description, 120)}</p> : null}</div>
              </article>
            );
          })}</div>
            : <EmptyNote preview={preview} text="No public events yet." />}
        </Wrap>
      );
    }
    case "staff": {
      const items = data.staff.slice(0, section.data.limit);
      if (!items.length && !preview) return null;
      return (
        <Wrap id={id} type="staff"><Heading text={section.data.heading} />
          {items.length ? <div className="st-grid">{items.map((s) => <article className="st-card" key={s.id}><div className="st-avatar" aria-hidden>{initials(s.name)}</div><h3>{s.name}</h3>{s.subject ? <p>{s.subject}</p> : null}</article>)}</div>
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
        <AdmissionForm action={enquiry} classes={section.data.classes} phone={phone} />
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
              <div><a className="st-btn st-ghost" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer">Get directions</a></div>
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
            {d.imageUrl ? <div className="st-split-media"><img src={d.imageUrl} alt={d.name ?? ""} loading="lazy" /></div> : null}
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
                  return <td key={j}>{isLink(c) ? <a className="st-view" href={c} target={c.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">View</a> : c}</td>;
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
        <ul className="st-links">{section.data.items.map((l, i) => <li key={i}><a href={l.href} target={l.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">{l.label}</a></li>)}</ul>
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

/** One public page of a school site, in the school's template and theme. */
export function SiteView({ school, template, theme, content, slug, data = EMPTY_DATA, enquiry, preview }: SiteViewProps) {
  const page: Page | undefined = content.pages.find((p) => p.slug === slug);
  if (!page) return null;
  const head = HEAD_FONT[template];
  const vars = { "--st-body": stack(theme.font, "system-ui, sans-serif"), "--st-head": head ? stack(head[0], head[1]) : stack(theme.font, "system-ui, sans-serif") } as CSSProperties;
  const hasApply = content.nav.some((n) => n.slug === "admissions");
  const contact = content.pages.flatMap((p) => p.sections).find((s): s is Extract<Section, { type: "contact" }> => s.type === "contact")?.data;
  const links = [{ label: "Home", slug: HOME_SLUG }, ...content.nav].map((n) => (
    <a key={n.slug} href={hrefOf(n.slug)} aria-current={n.slug === slug ? "page" : undefined} className={n.slug === "admissions" && n.slug !== slug ? "st-apply" : undefined}>{n.label}</a>
  ));
  // Inner pages open with a title banner unless the school put its own hero first.
  const banner = slug !== HOME_SLUG && page.sections[0]?.type !== "hero";
  const ld = slug === HOME_SLUG ? JSON.stringify({ "@context": "https://schema.org", "@type": "School", name: school.name, address: contact?.address, telephone: contact?.phone, email: contact?.email }).replace(/</g, "\\u003c") : null;
  return (
    <div className="st-root" data-template={template} style={vars}>
      <style dangerouslySetInnerHTML={{ __html: `${siteCss(theme)}${SITE_CSS}` }} />
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} /> : null}
      <a className="st-skip" href="#st-main">Skip to content</a>
      {preview ? <div className="st-preview" role="status">Draft preview. Visitors still see the published site.</div> : null}
      {contact?.phone || contact?.email ? (
        <div className="st-topbar"><div className="st-wrap">
          <span>{contact.hours ?? ""}</span>
          <span>{contact.phone ? <a href={tel(contact.phone)}>{contact.phone}</a> : null}{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}</span>
        </div></div>
      ) : null}
      <header className="st-header">
        <div className="st-wrap">
          <a className="st-brand" href="/">{school.logoUrl ? <img src={school.logoUrl} alt="" /> : null}<span>{school.name}</span></a>
          <nav className="st-nav" aria-label="Main">{links}</nav>
          <details className="st-menu">
            <summary><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>Menu</summary>
            <nav aria-label="Main, mobile">{links}</nav>
          </details>
        </div>
      </header>
      <main className="st-main" id="st-main">
        {banner ? (
          <div className="st-banner"><div className="st-wrap">
            <p className="st-crumb"><a href="/">Home</a><span aria-hidden>/</span><span>{page.title}</span></p>
            <h1>{page.title}</h1>
            {page.intro ? <p className="st-sub">{page.intro}</p> : null}
          </div></div>
        ) : null}
        {page.sections.length ? page.sections.map((s) => <Block key={s.id} section={s} data={data} enquiry={enquiry} preview={preview} phone={contact?.phone} />)
          : <section className="st-section"><div className="st-wrap"><p className="st-empty">This page is being written. Please check back soon.</p></div></section>}
      </main>
      <footer className="st-footer">
        <div className="st-wrap st-foot">
          <div className="st-foot-brand">
            <b>{school.name}</b>
            {contact ? <><span>{contact.address}</span>{contact.phone ? <a href={tel(contact.phone)}>{contact.phone}</a> : null}{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}</> : null}
          </div>
          <nav aria-label="Pages"><h3>Explore</h3><ul>{[{ label: "Home", slug: HOME_SLUG }, ...content.nav].map((n) => <li key={n.slug}><a href={hrefOf(n.slug)}>{n.label}</a></li>)}</ul></nav>
          {content.footer.links.length ? <nav aria-label="Footer"><h3>Quick links</h3><ul>{content.footer.links.map((l, i) => <li key={i}><a href={l.href}>{l.label}</a></li>)}</ul></nav> : null}
        </div>
        <div className="st-wrap st-foot-bar"><span>{content.footer.text ?? school.name}</span></div>
      </footer>
      {hasApply && slug !== "admissions" ? <a className="st-sticky-apply st-btn" href="/admissions">Apply for admission</a> : null}
    </div>
  );
}
