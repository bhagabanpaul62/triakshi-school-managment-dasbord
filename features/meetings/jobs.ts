import { eachSchool, MeetingSchedule } from "./schedule";

/** Scheduled by the worker (every 15 minutes, in apps/worker/src/registry.ts): reminders, then auto close and done. */
export default {
  "meetings.reminders": async () => {
    await eachSchool(async (ctx) => {
      const s = new MeetingSchedule(ctx, new Date());
      await s.reminders();
      await s.tidy();
    });
  },
} satisfies Record<string, () => Promise<unknown>>;
