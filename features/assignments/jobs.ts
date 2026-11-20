import { publishDue, sendDueReminders } from "./schedule";

/** Scheduled by the worker (the schedule lives in apps/worker/src/registry.ts): reminders and scheduled publishing. */
export default {
  "assignments.due-reminders": async () => { await sendDueReminders(new Date()); },
  "assignments.publish-due": async () => { await publishDue(new Date()); },
} satisfies Record<string, () => Promise<unknown>>;
