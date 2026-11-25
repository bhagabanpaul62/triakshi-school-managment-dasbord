import { HOME_SLUG } from "@smw/site-templates";

/** "/home" is the home page under a second address: where it goes, or null when the path is something else. A preview keeps it. */
export const homeAlias = (parts: string[], preview: boolean): "/" | null => (!preview && parts.length === 1 && parts[0] === HOME_SLUG ? "/" : null);

/** Which twelve of a long list to show for `?page=N`, with N clamped to what exists. */
export function pageOf(total: number, raw: unknown, per = 12): { page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(raw)) || 1));
  return { page, pages, from: (page - 1) * per, to: page * per };
}

export type ViewKind = { k: "page"; slug: string } | { k: "news" | "events" | "privacy" } | { k: "newsItem" | "eventItem"; id: string };

/**
 * What an address points at, or null when nothing lives there (the caller then answers 404). A hidden page counts only in a preview;
 * a page the school made wins over the built-in /news, /events and /privacy.
 */
export function pickView(parts: string[], pages: { slug: string; hidden?: boolean }[], preview: boolean): ViewKind | null {
  const has = (slug: string) => pages.some((p) => p.slug === slug && (!p.hidden || preview));
  if (parts.length === 0) return has(HOME_SLUG) ? { k: "page", slug: HOME_SLUG } : null;
  const [a, b] = parts as [string, string?];
  if (parts.length === 1) {
    if (has(a)) return { k: "page", slug: a };
    return a === "news" || a === "events" || a === "privacy" ? { k: a } : null;
  }
  if (parts.length === 2 && (a === "news" || a === "events")) return { k: a === "news" ? "newsItem" : "eventItem", id: b! };
  return null;
}
