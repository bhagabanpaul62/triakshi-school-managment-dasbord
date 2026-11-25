import { dateTime, shortDate } from "@smw/ui/format";
import { istDay } from "../dates";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** "18 Nov" · "8 Nov to 15 Nov" · "Nov 21, 9:00 am to 1:00 pm": the human time of an event. */
export function whenLabel(e: { startsAt: string; endsAt: string | null; allDay: boolean }): string {
  const sameDay = !e.endsAt || istDay(e.startsAt) === istDay(e.endsAt);
  if (e.allDay) return sameDay ? shortDate(e.startsAt) : `${shortDate(e.startsAt)} to ${shortDate(e.endsAt)}`;
  if (!e.endsAt) return dateTime(e.startsAt);
  return sameDay ? `${dateTime(e.startsAt)} to ${time(e.endsAt)}` : `${dateTime(e.startsAt)} to ${dateTime(e.endsAt)}`;
}
