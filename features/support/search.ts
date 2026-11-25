// Help search. Pure and client-safe: scores articles against what a person typed.
import { ARTICLES, type Article, type AreaKey, type Audience } from "./articles";

const STOP = new Set(["a", "an", "the", "to", "of", "in", "on", "is", "it", "my", "i", "how", "do", "does", "can", "we", "our", "for", "and", "or", "not", "with", "me", "no", "are", "was", "be", "at", "by", "from", "this", "that", "what", "when", "where", "why", "who", "your", "you", "if", "so"]);

/** Lower-case words, light plural stripping, stop words dropped. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const has = (hay: string[], w: string) => hay.some((h) => h === w);
const starts = (hay: string[], w: string) => w.length >= 3 && hay.some((h) => h.startsWith(w) || (w.startsWith(h) && h.length >= 4));

/** A score for one article. Title words count most, then keywords, then the summary, then the steps. Zero = no match. */
export function scoreArticle(a: Article, query: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const title = words(a.title), keys = a.keywords.flatMap(words), summary = words(a.summary), body = words([...a.steps, ...(a.notes ?? [])].join(" "));
  let score = 0, hit = 0;
  for (const w of q) {
    let s = 0;
    if (has(title, w)) s = 10; else if (has(keys, w)) s = 8; else if (starts(title, w)) s = 6; else if (starts(keys, w)) s = 5;
    else if (has(summary, w)) s = 4; else if (has(body, w)) s = 2; else if (starts(summary, w) || starts(body, w)) s = 1;
    if (s) { score += s; hit++; }
  }
  // An article that answers every word beats one that answers a single word.
  if (hit === q.length && q.length > 1) score += 6;
  // A phrase that is in the title word for word.
  if (a.title.toLowerCase().includes(query.trim().toLowerCase()) && query.trim().length >= 4) score += 10;
  return score;
}

export interface SearchOptions { area?: AreaKey; audience?: Audience; limit?: number }

/** Articles for a query, best first. With no query: every article of the area and audience, in the order written. */
export function searchArticles(query: string, opts: SearchOptions = {}, list: Article[] = ARTICLES): Article[] {
  const pool = list.filter((a) => (!opts.area || a.area === opts.area) && (!opts.audience || a.for.includes(opts.audience) || a.for.includes("everyone")));
  const scored = query.trim()
    ? pool.map((a, i) => ({ a, i, s: scoreArticle(a, query) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.a)
    : pool;
  return opts.limit ? scored.slice(0, opts.limit) : scored;
}
