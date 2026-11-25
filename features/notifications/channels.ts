// Which channels a topic uses for one person. Pure and client-safe: the writer, the preferences screen and the tests share it.
import type { EmailMode } from "./constants";
import type { GroupPref } from "./schema";
import { TOPICS, topicOf, type TopicGroup, type TopicKey } from "./topics";

export type GroupPrefs = Partial<Record<TopicGroup, GroupPref>>;
export type { GroupPref };
export const MUST_TELL: GroupPref = { push: true, email: "instant" };

const ALL = Object.values(TOPICS) as ReturnType<typeof topicOf>[];
const firstOpenTopic = (group: TopicGroup) => ALL.find((x) => x.group === group && !x.mustTell) ?? ALL.find((x) => x.group === group)!;

/** What a group does for a person: their own choice, else the school's, else the default of the group's first optional topic. */
export function effectiveGroup(group: TopicGroup, personGroups: GroupPrefs = {}, schoolDefaults: GroupPrefs = {}): GroupPref {
  const t = firstOpenTopic(group);
  return personGroups[group] ?? schoolDefaults[group] ?? { push: t.push, email: t.email };
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
