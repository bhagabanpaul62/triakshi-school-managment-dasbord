// iCalendar (RFC 5545) as plain text. Pure: no database, no framework. Times are written in UTC, all-day items as dates.
import { sha256 } from "@smw/feature-kit/secret";
import { addDays, istDay } from "./dates";

export interface IcsItem {
  /** Stable for the life of the item: the same id means the same calendar entry on a phone. */
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startsAt: Date;
  /** For all-day items: the last instant of the last IST day, as the events table stores it. */
  endsAt: Date | null;
  allDay: boolean;
  sequence?: number;
  cancelled?: boolean;
  /** When the item last changed. */
  stamp: Date;
}

const enc = new TextEncoder();
const compactDay = (ymd: string) => ymd.replaceAll("-", "");
/** "20261121T033000Z" */
export const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** Backslash, semicolon, comma and line breaks, as the format requires. */
export const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Lines are at most 75 octets: the rest continues on lines that start with one space. A character is never cut in half. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const prop = (name: string, value: string) => foldLine(`${name}:${value}`);

function eventLines(e: IcsItem): string[] {
  const l = ["BEGIN:VEVENT", prop("UID", e.uid), `DTSTAMP:${icsStamp(e.stamp)}`];
  if (e.allDay) {
    const first = istDay(e.startsAt);
    // DTEND of a date is the day after the last day.
    l.push(`DTSTART;VALUE=DATE:${compactDay(first)}`, `DTEND;VALUE=DATE:${compactDay(addDays(e.endsAt ? istDay(new Date(e.endsAt.getTime() - 1)) : first, 1))}`);
  } else {
    l.push(`DTSTART:${icsStamp(e.startsAt)}`);
    if (e.endsAt) l.push(`DTEND:${icsStamp(e.endsAt)}`);
  }
  l.push(prop("SUMMARY", escapeText(e.title)));
  if (e.description) l.push(prop("DESCRIPTION", escapeText(e.description)));
  if (e.location) l.push(prop("LOCATION", escapeText(e.location)));
  if (e.url) l.push(prop("URL", e.url));
  l.push(`SEQUENCE:${e.sequence ?? 0}`, `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`, `TRANSP:${e.allDay ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  return l;
}

export interface IcsOptions { name: string; /** How often phones are asked to look again. */ refreshHours?: number }

/** A whole calendar file. Lines end in CRLF, as the format requires. */
export function buildCalendar(items: IcsItem[], o: IcsOptions): string {
  const hours = o.refreshHours ?? 12;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Triakshi//School calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeText(o.name)), "X-WR-TIMEZONE:Asia/Kolkata",
    `REFRESH-INTERVAL;VALUE=DURATION:PT${hours}H`, `X-PUBLISHED-TTL:PT${hours}H`,
    ...items.flatMap(eventLines), "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** The parts of an event row a phone calendar may carry. Nothing private: no answers, no people, no files. */
export interface IcsSource {
  id: string; title: string; description: string | null; bring: string | null; location: string | null; mapUrl: string | null;
  startsAt: Date; endsAt: Date | null; allDay: boolean; sequence: number; state: string; cancelReason: string | null; updatedAt: Date;
}

/** One event as a calendar entry. `host` is the school's own address, e.g. "greenfield.example.com". */
export function eventItem(e: IcsSource, host: string): IcsItem {
  const cancelled = e.state === "cancelled";
  const text = [cancelled ? `Cancelled: ${e.cancelReason ?? ""}`.trim() : "", e.description ?? "", e.bring ? `Bring: ${e.bring}` : "", e.mapUrl ?? ""].filter(Boolean).join("\n\n");
  return { uid: `event-${e.id}@${host}`, title: e.title, description: text || null, location: e.location, url: `https://${host}/app/events/${e.id}`, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, sequence: e.sequence, cancelled, stamp: e.updatedAt };
}

/** A layer item (holiday, exam, homework due, meeting, fee due date) as a calendar entry: title and time only. */
export function layerItem(i: { id: string; layer: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; href: string | null }, host: string, stamp: Date): IcsItem {
  return { uid: `${i.layer}-${i.id}@${host}`, title: i.title, startsAt: new Date(i.startsAt), endsAt: i.endsAt ? new Date(i.endsAt) : null, allDay: i.allDay, url: i.href ? `https://${host}${i.href}` : null, stamp };
}

/** A short fingerprint of the file. Same bytes, same ETag, so a phone that already has them is told "not modified". */
export const calendarEtag = (body: string) => `"${sha256(body).slice(0, 32)}"`;
