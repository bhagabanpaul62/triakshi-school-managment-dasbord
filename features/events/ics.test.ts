import { describe, expect, it } from "vitest";
import { buildCalendar, calendarEtag, escapeText, foldLine, icsStamp, type IcsItem } from "./ics";
import { addDays, addMonthsClamped, daysOf, viewRange, weekStart } from "./dates";
import { onDay, repeatDays } from "./repeat";
import { parseIst } from "./dates";

const stamp = new Date("2026-11-20T06:00:00Z");
const item = (o: Partial<IcsItem> = {}): IcsItem => ({ uid: "e1@school.test", title: "Parents evening", startsAt: new Date("2026-11-21T03:30:00Z"), endsAt: new Date("2026-11-21T07:30:00Z"), allDay: false, stamp, ...o });
const lines = (s: string) => s.split("\r\n");
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("iCalendar text", () => {
  it("a title with ; , and a backslash is escaped in SUMMARY", () => {
    expect(buildCalendar([item({ title: "A; B, C\\D" })], { name: "S" })).toContain("SUMMARY:A\\; B\\, C\\\\D\r\n");
  });

  it("a timed event in UTC, golden", () => {
    expect(buildCalendar([item({ location: "Main hall, Block A", description: "Bring the card;\nsee you", sequence: 2, url: "https://s.test/app/events/e1" })], { name: "School", refreshHours: 12 })).toBe([
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Triakshi//School calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:School", "X-WR-TIMEZONE:Asia/Kolkata",
      "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
      "BEGIN:VEVENT", "UID:e1@school.test", "DTSTAMP:20261120T060000Z", "DTSTART:20261121T033000Z", "DTEND:20261121T073000Z", "SUMMARY:Parents evening",
      "DESCRIPTION:Bring the card\\;\\nsee you", "LOCATION:Main hall\\, Block A", "URL:https://s.test/app/events/e1", "SEQUENCE:2", "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT",
      "END:VCALENDAR", "",
    ].join("\r\n"));
  });

  it("all-day items use dates and an exclusive end; a one-day item ends the next day", () => {
    const span = buildCalendar([item({ allDay: true, startsAt: new Date("2026-11-07T18:30:00Z"), endsAt: new Date("2026-11-15T18:29:59.999Z") })], { name: "S" });
    expect(span).toContain("DTSTART;VALUE=DATE:20261108\r\n");
    expect(span).toContain("DTEND;VALUE=DATE:20261116\r\n");
    expect(span).toContain("TRANSP:TRANSPARENT");
    const one = buildCalendar([item({ allDay: true, startsAt: new Date("2026-12-24T18:30:00Z"), endsAt: null })], { name: "S" });
    expect(one).toContain("DTSTART;VALUE=DATE:20261225\r\n");
    expect(one).toContain("DTEND;VALUE=DATE:20261226\r\n");
  });

  it("a cancelled event keeps its UID and says so", () => {
    const text = buildCalendar([item({ cancelled: true, sequence: 3 })], { name: "S" });
    expect(text).toContain("STATUS:CANCELLED");
    expect(text).toContain("SEQUENCE:3");
    expect(text).toContain("UID:e1@school.test");
  });

  it("every line ends in CRLF and none is longer than 75 octets, even in Hindi", () => {
    const hindi = "वार्षिक खेलकूद प्रतियोगिता और पुरस्कार वितरण समारोह, सभी अभिभावक सादर आमंत्रित हैं।";
    const text = buildCalendar([item({ title: hindi, description: hindi.repeat(3), location: "विद्यालय का मैदान" })], { name: "S" });
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    for (const l of lines(text)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const back = unfold(text);
    expect(back).toContain(`SUMMARY:${escapeText(hindi)}`);
    expect(back).toContain(`DESCRIPTION:${escapeText(hindi.repeat(3))}`);
    expect(text).not.toContain("�");
  });

  it("folding keeps every character whole and rebuilds the original", () => {
    const s = "SUMMARY:" + "ए".repeat(60) + "x".repeat(70) + "😀".repeat(20);
    const folded = foldLine(s);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(s);
    expect(foldLine("short")).toBe("short");
  });

  it("text is escaped: backslash, semicolon, comma and line breaks", () => {
    expect(escapeText("a\\b;c,d\r\ne\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("unescaping gives back the original text", () => {
    const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
    for (const s of ["a\\b;c,d\ne", "\\n literal;;,,", "x\\;y", "plain"]) expect(unescape(escapeText(s))).toBe(s);
  });

  it("timestamps are plain UTC", () => expect(icsStamp(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z"));
});

describe("validator", () => {
  it("a full calendar is well formed: balanced, CRLF, required properties on every event, stable bytes", () => {
    const items = [item(), item({ uid: "e2@school.test", allDay: true, endsAt: null, cancelled: true }), item({ uid: "e3@school.test", title: "वार्षिक उत्सव", endsAt: null })];
    const text = buildCalendar(items, { name: "School" });
    const ls = lines(text).filter(Boolean);
    expect(ls[0]).toBe("BEGIN:VCALENDAR");
    expect(ls.at(-1)).toBe("END:VCALENDAR");
    expect(text.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
    const begins = ls.filter((l) => l === "BEGIN:VEVENT").length;
    expect(begins).toBe(3);
    expect(ls.filter((l) => l === "END:VEVENT")).toHaveLength(3);
    for (const block of text.split("BEGIN:VEVENT").slice(1)) for (const p of ["UID:", "DTSTAMP:", "DTSTART", "SUMMARY:", "SEQUENCE:", "STATUS:"]) expect(block).toContain(p);
    expect(new Set(ls.filter((l) => l.startsWith("UID:"))).size).toBe(3);
    expect(buildCalendar(items, { name: "School" })).toBe(text);
    expect(calendarEtag(text)).toBe(calendarEtag(buildCalendar(items, { name: "School" })));
    expect(calendarEtag(text)).not.toBe(calendarEtag(buildCalendar(items.slice(1), { name: "School" })));
  });
});

describe("date helpers", () => {
  it("weeks start on Monday; views cover whole IST days", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // a Sunday belongs to the week before
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    const m = viewRange("month", "2026-02-10");
    expect([m.fromDay, m.toDay]).toEqual(["2026-02-01", "2026-03-01"]);
    expect(m.from.toISOString()).toBe("2026-01-31T18:30:00.000Z");
    expect(viewRange("year", "2026-07-01").toDay).toBe("2027-01-01");
    expect(viewRange("agenda", "2026-12-20").toDay).toBe("2027-02-18");
  });

  it("an item touches each IST day it covers, and a midnight end does not touch the next day", () => {
    expect(daysOf("2026-11-07T18:30:00Z", "2026-11-09T18:29:59.999Z")).toEqual(["2026-11-08", "2026-11-09"]);
    expect(daysOf("2026-11-21T10:00:00Z", "2026-11-21T18:30:00Z")).toEqual(["2026-11-21"]);
    expect(daysOf("2026-11-21T18:00:00Z", null)).toEqual(["2026-11-21"]); // 23:30 IST
    expect(daysOf("2026-11-21T19:00:00Z", null)).toEqual(["2026-11-22"]); // 00:30 IST
  });

  it("month arithmetic clamps", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-12-15", 2)).toBe("2027-02-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("repeat dates", () => {
  it("weekly and fortnightly, inclusive of the last day, and one extra when over the cap", () => {
    expect(repeatDays("2026-11-02", { kind: "weekly", until: "2026-11-23" })).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
    expect(repeatDays("2026-11-02", { kind: "fortnightly", until: "2026-11-22" })).toEqual(["2026-11-02", "2026-11-16"]);
    expect(repeatDays("2026-01-01", { kind: "weekly", until: "2040-01-01" })).toHaveLength(61);
  });

  it("the same time of day and length on another day, all-day spans included", () => {
    const t = onDay({ startsAt: parseIst("2026-11-02T15:30")!, endsAt: parseIst("2026-11-02T16:45")!, allDay: false }, "2026-11-09");
    expect([t.startsAt.toISOString(), t.endsAt!.toISOString()]).toEqual(["2026-11-09T10:00:00.000Z", "2026-11-09T11:15:00.000Z"]);
    const d = onDay({ startsAt: parseIst("2026-11-02")!, endsAt: new Date(parseIst("2026-11-04")!.getTime() + 86_399_999), allDay: true }, "2026-12-07");
    expect(daysOf(d.startsAt, d.endsAt)).toEqual(["2026-12-07", "2026-12-08", "2026-12-09"]);
  });
});
