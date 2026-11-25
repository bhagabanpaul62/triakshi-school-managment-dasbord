// What an approver should look at again after a send-back: the parts of the notice, other than its title and words, that differ from what they last saw. Pure.
const LABEL: Record<string, string> = {
  categoryId: "Category", audience: "Who it is for", response: "What people must do", dueAt: "Answer by", reminders: "Reminders", website: "Website",
  lang2: "Second language", title2: "Second language", body2: "Second language", expiresAt: "Ends on", pinnedUntil: "Pinned until", type: "Kind",
};

/** Plain names of the settings that changed between the version the approver saw (`seen`) and the notice now. Each name once, in the order above. */
export function changedSettings(seen: Record<string, unknown>, now: Record<string, unknown>): string[] {
  // Dates come out of the saved snapshot as text; compare both sides as text.
  const flat = (v: unknown) => JSON.stringify(v === undefined ? null : v);
  const names = Object.entries(LABEL).filter(([k]) => flat(seen[k]) !== flat(JSON.parse(JSON.stringify({ v: now[k] ?? null })).v));
  return [...new Set(names.map(([, label]) => label))];
}
