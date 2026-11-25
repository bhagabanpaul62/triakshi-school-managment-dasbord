// Client-safe constants for the calendar.
export const EVENT_TYPES = { event: "Event", meeting: "Meeting", trip: "Trip", competition: "Competition", cultural: "Cultural", sports: "Sports" } as const;
export type EventType = keyof typeof EVENT_TYPES;
export type EventState = "draft" | "live" | "cancelled";
export type RsvpAnswer = "yes" | "maybe" | "no";
export interface RsvpSpec { on: boolean; capacity?: number; guests?: number; closesAt?: string }
export const MAX_REPEAT = 60;
/** What the calendar can show besides events. The app supplies each layer (apps/school/src/lib/calendar-layers.ts). */
export const LAYERS = { events: "Events", holidays: "Holidays", exams: "Exams", homework: "Homework due", timetable: "Special days", meetings: "Meetings", fees: "Fee due dates" } as const;
export type LayerKey = keyof typeof LAYERS;
export interface CalendarItem { id: string; layer: LayerKey; title: string; startsAt: string; endsAt: string | null; allDay: boolean; href: string | null; cancelled?: boolean; meta?: string; /** Events only: the colour comes from it. */ type?: EventType }

/** The colour of a type comes from here, never from the person adding the event. */
export const TYPE_TONE: Record<EventType, "default" | "success" | "warning" | "danger" | "info"> = { event: "info", meeting: "default", trip: "warning", competition: "danger", cultural: "success", sports: "success" };
export const LAYER_TONE: Record<LayerKey, "default" | "success" | "warning" | "danger" | "info"> = { events: "info", holidays: "warning", exams: "danger", homework: "default", timetable: "default", meetings: "info", fees: "warning" };

export const REPEATS = { none: "Does not repeat", weekly: "Every week", fortnightly: "Every two weeks", monthly: "Every month" } as const;
export type RepeatKind = keyof typeof REPEATS;
export interface RepeatSpec { kind: Exclude<RepeatKind, "none">; /** Last day, "YYYY-MM-DD" (IST). */ until: string; skipClosed: boolean }
/** Which dates of a series a change reaches. */
export const SCOPES = { this: "Only this event", later: "This and the ones after it", all: "Every event in the series" } as const;
export type Scope = keyof typeof SCOPES;

/** Minutes before the start. The first two are the default. */
export const REMINDER_CHOICES = [{ minutes: 10080, label: "1 week before" }, { minutes: 1440, label: "1 day before" }, { minutes: 120, label: "2 hours before" }, { minutes: 60, label: "1 hour before" }, { minutes: 30, label: "30 minutes before" }] as const;
export const DEFAULT_REMINDERS = [1440, 120];

/** "Tomorrow" for 1440, "In 2 hours" for 120. */
export function reminderWords(minutes: number): string {
  if (minutes === 1440) return "Tomorrow";
  if (minutes === 10080) return "In 1 week";
  if (minutes % 1440 === 0) return `In ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `In ${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `In ${minutes} minutes`;
}
