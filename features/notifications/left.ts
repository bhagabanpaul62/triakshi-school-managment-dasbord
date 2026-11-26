import { LEFT_TOPIC } from "@smw/runtime/phase";
import { TOPICS, type TopicKey } from "./topics";

/** Topics a student who left no longer sees in the bell or the list: they are about modules the login lost, so their link would lead to a refusal. */
export const hiddenForLeft = (): TopicKey[] => (Object.keys(TOPICS) as TopicKey[]).filter((k) => !LEFT_TOPIC.test(k));
