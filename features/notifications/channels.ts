// Which channels a topic uses for one person. Pure and client-safe: the writer, the preferences screen and the tests share it.
import type { EmailMode } from "./constants";
import type { GroupPref } from "./schema";
import { TOPICS, topicOf, type TopicGroup, type TopicKey } from "./topics";

export type GroupPrefs = Partial<Record<TopicGroup, GroupPref>>;
export type { GroupPref };
/** Families are the student logins; every other login is staff. */
export type Side = "staff" | "families";
export const SIDES: readonly Side[] = ["staff", "families"];
export const sideOf = (role: string): Side => (role === "student" ? "families" : "staff");
/** The school's default channels, per side and group. */
export type ChannelDefaults = Record<Side, GroupPrefs>;
/** The only reader of the school's defaults: the part that applies to this role. */
export const defaultsFor = (d: ChannelDefaults | undefined, role: string): GroupPrefs => d?.[sideOf(role)] ?? {};
export const MUST_TELL: GroupPref = { push: true, email: "instant" };

const ALL = Object.values(TOPICS) as ReturnType<typeof topicOf>[];
const firstOpenTopic = (group: TopicGroup) => ALL.find((x) => x.group === group && !x.mustTell) ?? ALL.find((x) => x.group === group)!;
/** What a group does when nobody has chosen: the default of its first optional topic. */
export const groupDefault = (group: TopicGroup): GroupPref => { const t = firstOpenTopic(group); return { push: t.push, email: t.email }; };

/** What a group does for a person: their own choice, else the school's, else the default of the group's first optional topic. */
export function effectiveGroup(group: TopicGroup, personGroups: GroupPrefs = {}, schoolDefaults: GroupPrefs = {}): GroupPref {
  return personGroups[group] ?? schoolDefaults[group] ?? groupDefault(group);
}

/** Order: the topic's default, then the school's default for its group, then the person's own choice. Must-tell topics ignore all of it. */
export function channelsFor(topic: TopicKey, personGroups: GroupPrefs = {}, schoolDefaults: GroupPrefs = {}): { push: boolean; email: EmailMode } {
  const t = topicOf(topic);
  if (t.mustTell) return { ...MUST_TELL };
  const g = personGroups[t.group] ?? schoolDefaults[t.group] ?? { push: t.push, email: t.email };
  return { push: g.push, email: g.email };
}

/** 1 urgent, 2 safety, 3 needs an answer, 4 the rest. */
export const priorityOf = (topic: TopicKey, urgent = false): 1 | 2 | 3 | 4 => (urgent ? 1 : topicOf(topic).priority ?? 4);
