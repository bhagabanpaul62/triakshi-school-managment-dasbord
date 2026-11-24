import type { Field } from "@smw/ui/shell/FormModal";
import type { Tone } from "@smw/ui/tone";
import { toInputValue } from "../dates";
import type { SchoolEvent } from "../service";

export const AUDIENCE_LABELS: Record<string, string> = { all: "Everyone", staff: "Staff", students: "Students", parents: "Families", class: "One class" };
export const audienceOptions = Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }));
/** Event tones are tone names; the kit decides the colour. */
export const TONE_LABELS: Record<string, string> = { default: "Neutral", info: "Blue", success: "Green", warning: "Amber" };

export const eventFields = (classes: { value: string; label: string }[]): Field[] => [
  { name: "title", label: "Title", required: true, wide: true },
  { name: "description", label: "Details", type: "textarea" },
  { name: "startsAt", label: "Starts", type: "datetime-local", required: true },
  { name: "endsAt", label: "Ends", type: "datetime-local", hint: "Leave empty for a single moment" },
  { name: "allDay", label: "All day", type: "checkbox", placeholder: "Whole days, ignore the time" },
  { name: "isHoliday", label: "Holiday", type: "checkbox", placeholder: "School is closed" },
  { name: "location", label: "Where" },
  { name: "audience", label: "Who is invited", type: "select", required: true, options: audienceOptions, hint: "Families see it on the student login" },
  { name: "classId", label: "Which class", type: "select", options: classes, hint: "Only used when \"One class\" is chosen" },
  { name: "tone", label: "Colour on the calendar", type: "select", required: true, options: Object.entries(TONE_LABELS).map(([value, label]) => ({ value, label })) },
  { name: "isPublic", label: "Website", type: "checkbox", placeholder: "Show on the school website" },
];

/** What the pages and the calendar pass around: plain data only (ISO strings, no Date objects). */
export interface EventView {
  id: string; title: string; description: string | null; startsAt: string; endsAt: string | null; allDay: boolean;
  location: string | null; audience: string; classId: string | null; isPublic: boolean; isHoliday: boolean; tone: Tone;
}

export const toView = (e: SchoolEvent): EventView => ({
  id: e.id, title: e.title, description: e.description, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null,
  allDay: e.allDay, location: e.location, audience: e.audience, classId: e.classId, isPublic: e.isPublic, isHoliday: e.isHoliday, tone: e.tone,
});

/** Initial values for the edit form: dates as IST datetime-local strings. */
export const toFormValues = (e: EventView): Record<string, unknown> => ({ ...e, startsAt: toInputValue(e.startsAt), endsAt: toInputValue(e.endsAt) });
