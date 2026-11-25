/** An address of this site with the preview query added, so a click in a preview stays in the preview. Anything else is left alone. */
export function withPreview(href: string, query: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || /^\/(app|api|login|_next)(\/|$|\?|#)/.test(href)) return href;
  const [path, hash] = href.split("#", 2) as [string, string | undefined];
  const [p, q = ""] = path.split("?", 2) as [string, string | undefined];
  const have = new URLSearchParams(q);
  for (const [k, v] of new URLSearchParams(query)) if (!have.has(k)) have.append(k, v);
  return `${p}?${have.toString()}${hash !== undefined ? `#${hash}` : ""}`;
}
