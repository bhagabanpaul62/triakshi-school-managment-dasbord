/* eslint-disable @next/next/no-img-element -- school photos are arbitrary https links, so next/image cannot optimise them */
import type { ReactNode } from "react";
import { parseMarkdown, type Inline } from "@smw/ui/markdown";
import { ClickLoad } from "./ClickLoad";
import type { Section, SectionData } from "./content";
import { DISCLOSURE_PARTS, DISCLOSURE_ROWS, type DisclosurePart, type DisclosureRow } from "./disclosure";
import { fileSize, videoEmbed } from "./site-utils";

export const dateOnly = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const external = (href: string) => !href.startsWith("/");

export function Wrap({ id, type, children, className = "" }: { id: string; type: string; children: ReactNode; className?: string }) {
  // "st-sec-": the inner grids own the plain names (st-contact, st-faq...), so the section must not share them.
  return <section id={id} className={`st-section st-sec-${type} ${className}`.trim()}><div className="st-wrap">{children}</div></section>;
}
export const Heading = ({ text, intro }: { text?: string; intro?: string }) => (text || intro ? <div className="st-head">{text ? <h2>{text}</h2> : null}{intro ? <p>{intro}</p> : null}</div> : null);

/** A link that opens another site says so, for screen readers too. */
export const Out = ({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }) => (
  <a className={className} href={href} aria-label={label} {...(external(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
    {children}{external(href) ? <span className="st-sr"> (opens in a new tab)</span> : null}
  </a>
);

function Inl({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "b") return <strong key={i}><Inl nodes={n.c} /></strong>;
    if (n.t === "i") return <em key={i}><Inl nodes={n.c} /></em>;
    return <a key={i} href={n.href} rel="noopener noreferrer" {...(/^https?:/i.test(n.href) ? { target: "_blank" } : {})}><Inl nodes={n.c} /></a>;
  });
}
/** The notice and event text (safe markdown subset) in the site's own look. Never injects HTML. */
export function SiteMarkdown({ source }: { source: string }) {
  return (
    <div className="st-prose">
      {parseMarkdown(source).map((b, i) => {
        if (b.t === "p") return <p key={i} className="st-pre"><Inl nodes={b.c} /></p>;
        if (b.t === "h") return <h2 key={i} className="st-h3"><Inl nodes={b.c} /></h2>;
        const L = b.t;
        return <L key={i}>{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</L>;
      })}
    </div>
  );
}

export function VideoBlock({ section }: { section: Extract<Section, { type: "video" }> }) {
  const d = section.data;
  const v = videoEmbed(d.url);
  return (
    <Wrap id={section.id} type="video"><Heading text={d.heading} intro={d.intro} />
      <div className="st-video">
        {v ? <ClickLoad className="st-player" href={v.watch} embed={v.embed} title={d.title} label={`Play: ${d.title}`} />
          : <Out className="st-click st-player" href={d.url}>Watch: {d.title}</Out>}
      </div>
      <p className="st-note">The video loads from {v?.provider === "vimeo" ? "Vimeo" : "YouTube"} only when you press play.</p>
    </Wrap>
  );
}

export function DocumentsBlock({ section }: { section: Extract<Section, { type: "documents" }> }) {
  const d = section.data;
  const groups = new Map<string, typeof d.items>();
  for (const it of d.items) groups.set(it.group?.trim() || "", [...(groups.get(it.group?.trim() || "") ?? []), it]);
  const named = [...groups.keys()].some(Boolean);
  return (
    <Wrap id={section.id} type="documents"><Heading text={d.heading} intro={d.intro} />
      <div className="st-docgroups">
        {[...groups].map(([name, items]) => (
          <div key={name} className="st-docgroup">
            {named ? <h3>{name || "Other"}</h3> : null}
            <ul className="st-docs">
              {items.map((it, i) => {
                const meta = [it.date ? dateOnly(it.date) : "", fileSize(it.size)].filter(Boolean).join(" · ");
                return (
                  <li key={i}><Out className="st-doc" href={it.url}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                    <span className="st-doc-name">{it.label}{meta ? <small>{meta}</small> : null}</span>
                    <span className="st-view" aria-hidden>Open</span>
                  </Out></li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

function Portrait({ url, name }: { url?: string; name: string }) {
  return url ? <img className="st-portrait" src={url} alt={`Photo of ${name}`} loading="lazy" /> : <div className="st-avatar st-portrait" aria-hidden>{initials(name)}</div>;
}

export function PeopleBlock({ section }: { section: Extract<Section, { type: "people" }> }) {
  const d = section.data;
  return (
    <Wrap id={section.id} type="people"><Heading text={d.heading} intro={d.intro} />
      <ul className="st-people">{d.items.map((p, i) => (
        <li className="st-person" key={i}><Portrait url={p.imageUrl} name={p.name} />
          <h3>{p.name}</h3>{p.role ? <span className="st-role">{p.role}</span> : null}{p.text ? <p>{p.text}</p> : null}</li>
      ))}</ul>
    </Wrap>
  );
}

export function AchieversBlock({ section }: { section: Extract<Section, { type: "achievers" }> }) {
  const d = section.data;
  return (
    <Wrap id={section.id} type="achievers"><Heading text={d.heading} intro={d.intro} />
      <ul className="st-people st-achievers">{d.items.map((p, i) => (
        <li className="st-person" key={i}><Portrait url={p.imageUrl} name={p.name} />
          <h3>{p.name}</h3><span className="st-result">{p.result}</span>{p.year ? <span className="st-role">{p.year}</span> : null}</li>
      ))}</ul>
    </Wrap>
  );
}

export type DisclosureProfile = Partial<Record<NonNullable<DisclosureRow["profile"]>, string | null>>;

function DisclosureCell({ row, v, profile }: { row: DisclosureRow; v: SectionData<"disclosure">["data"]["values"][string] | undefined; profile: DisclosureProfile }) {
  if (v?.na) return <>Not applicable</>;
  if (v?.url) return <><Out className="st-view" href={v.url} label={`View ${row.label}`}>View</Out>{v.expiresOn ? <small className="st-hint"> Valid until {dateOnly(v.expiresOn)}</small> : null}</>;
  const text = v?.text || (row.profile ? profile[row.profile] : null);
  return text ? <>{text}</> : <span className="st-muted">Not available</span>;
}

/** The mandatory disclosure in its five parts, drawn from the frozen data of the section. */
export function DisclosureBlock({ section, profile }: { section: Extract<Section, { type: "disclosure" }>; profile: DisclosureProfile }) {
  const d = section.data;
  return (
    <Wrap id={section.id} type="disclosure"><Heading text={d.heading} intro={d.intro} />
      <div className="st-disclosure">
        {(Object.keys(DISCLOSURE_PARTS) as DisclosurePart[]).map((part, n) => (
          <div key={part} className="st-dpart">
            <h3>{String.fromCharCode(65 + n)}. {DISCLOSURE_PARTS[part]}</h3>
            <div className="st-table-wrap" role="region" aria-label={DISCLOSURE_PARTS[part]} tabIndex={0}>
              <table className="st-table">
                <thead><tr><th scope="col">Information</th><th scope="col">Details</th></tr></thead>
                <tbody>{DISCLOSURE_ROWS.filter((r) => r.part === part).map((r) => (
                  <tr key={r.key}><th scope="row">{r.label}</th><td><DisclosureCell row={r} v={d.data.values[r.key]} profile={profile} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      {d.updatedOn ? <p className="st-note">Last updated {dateOnly(d.updatedOn)}.</p> : null}
    </Wrap>
  );
}
