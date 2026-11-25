import { describe, expect, it } from "vitest";
import { dayTime, dayWord, stateLine } from "./when";
import { unshown } from "./form-errors";

// 2026-11-25 10:00 in India
const NOW = new Date("2026-11-25T04:30:00Z");

describe("when words", () => {
  it("always carry the day", () => {
    expect(dayWord(new Date("2026-11-25T20:00:00Z"), NOW)).toBe("tomorrow");
    expect(dayWord(new Date("2026-11-25T08:00:00Z"), NOW)).toBe("today");
    expect(dayWord(new Date("2026-11-30T01:30:00Z"), NOW)).toBe("Mon 30 Nov");
    expect(dayTime(new Date("2026-11-25T20:30:00Z"), NOW)).toBe("tomorrow 2:00 am");
  });
  it("the state line goes Waiting, Delivered, Seen", () => {
    expect(stateLine({ deliverAfter: "2026-11-26T01:30:00Z", seen: null }, NOW)).toBe("Waiting until tomorrow 7:00 am");
    expect(stateLine({ deliverAfter: null, seen: { by: 0, of: 1, at: null } }, NOW)).toBe("Delivered");
    expect(stateLine({ deliverAfter: null, seen: { by: 1, of: 1, at: "2026-11-25T05:00:00Z" } }, NOW)).toBe("Seen today 10:30 am");
  });
});

describe("no refusal is invisible", () => {
  it("a field the form does not show is said once; shown fields say nothing extra", () => {
    expect(unshown({ error: "Please fix the highlighted fields.", fieldErrors: { body: "You can start a new one tomorrow at 12:51 pm." } }, ["subject", "details"])).toMatchObject({ text: "You can start a new one tomorrow at 12:51 pm." });
    expect(unshown({ error: "x", fieldErrors: { subject: "Add a title" } }, ["subject"])).toBeNull();
    expect(unshown({ error: "x", fieldErrors: { "values.a": "Needed" } }, ["values.*"])).toBeNull();
    expect(unshown({ error: "This conversation is closed." }, ["subject"])).toMatchObject({ text: "This conversation is closed." });
  });
});
