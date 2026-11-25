// A refusal must never be invisible: whatever the server said that no field on the form shows, the form shows once as a sentence. Pure, so it is tested.
export interface Failure { error: string; fieldErrors?: Record<string, string> }

/** The sentence for errors no field displays: all of them when the server named no field, else only the unshown fields' messages. `shown` entries may end in `*` (a prefix). Null when every error has its place. */
export function unshown(r: Failure, shown: readonly string[]): { text: string; keys: string[] } | null {
  const all = Object.keys(r.fieldErrors ?? {});
  if (!all.length) return { text: r.error, keys: [] };
  const lost = all.filter((k) => !shown.some((s) => (s.endsWith("*") ? k.startsWith(s.slice(0, -1)) : k === s)));
  return lost.length ? { text: [...new Set(lost.map((k) => r.fieldErrors![k]))].join(" "), keys: lost } : null;
}
