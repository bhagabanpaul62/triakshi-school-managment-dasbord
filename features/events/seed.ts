import type { FeatureSeed } from "@smw/feature-kit";
import { EventService } from "./service";

type Draft = Record<string, string>;

/** A school year of events: holidays, programmes and exams. Some are public (website). */
const YEAR: Draft[] = [
  { title: "Independence Day", description: "Flag hoisting at 8 am, followed by cultural programme and sweets.", startsAt: "2026-08-15", isHoliday: "true", isPublic: "true", tone: "success", location: "School ground" },
  { title: "Half-yearly examinations", description: "Exams for Classes 6 to 12. Admit cards are on the Exams page.", startsAt: "2026-09-22", endsAt: "2026-09-30", allDay: "true", audience: "students", tone: "info" },
  { title: "Gandhi Jayanti", startsAt: "2026-10-02", isHoliday: "true", isPublic: "true", tone: "warning" },
  { title: "Diwali break", description: "School reopens on Monday, 16 November.", startsAt: "2026-11-08", endsAt: "2026-11-15", isHoliday: "true", isPublic: "true", tone: "warning" },
  { title: "Children's Day", description: "Games, fun stalls and a special assembly by teachers.", startsAt: "2026-11-14T09:00", endsAt: "2026-11-14T13:00", isPublic: "true", tone: "success", location: "School ground" },
  { title: "Parent-Teacher Meeting", description: "Meet the class teacher and collect the term progress card.", startsAt: "2026-11-21T09:00", endsAt: "2026-11-21T13:00", audience: "parents", tone: "info", location: "Classrooms" },
  { title: "Science Exhibition", description: "Working models by Classes 6 to 10. Visitors welcome.", startsAt: "2026-11-28T10:00", endsAt: "2026-11-28T15:00", isPublic: "true", tone: "info", location: "Main hall" },
  { title: "Annual Day", description: "Prize distribution and performances. Parents are invited.", startsAt: "2026-12-20T17:00", endsAt: "2026-12-20T20:00", isPublic: "true", tone: "success", location: "Auditorium" },
  { title: "Sports Day", description: "Track and field, relay races and the house trophy.", startsAt: "2027-01-16T08:00", endsAt: "2027-01-16T16:00", isPublic: "true", location: "Sports ground" },
  { title: "Republic Day", startsAt: "2027-01-26", isHoliday: "true", isPublic: "true", tone: "success" },
];

/** Demo data for one school. */
const seed: FeatureSeed = async (ctx) => {
  const svc = new EventService(ctx);
  for (const e of YEAR) await svc.create(e);
};
export default seed;
