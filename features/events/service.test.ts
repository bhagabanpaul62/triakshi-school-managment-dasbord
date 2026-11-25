import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "@smw/feature-notifications/feature";
import { commGroups, notifications } from "@smw/feature-notifications/schema";
import { attendanceHolidays } from "@smw/feature-attendance/schema";
import { addDays, istDay, toInputValue, viewRange } from "./dates";
import eventsFeature from "./feature";
import { lateJoiners } from "./people";
import { eventPeople, events } from "./schema";
import { students } from "@smw/feature-students/schema";
import { EventService } from "./service";
import { asUser, FEATURES, fixture, type Fixture } from "./test-fixture";

let a: TestSchool, b: TestSchool, fx: Fixture;
beforeAll(async () => {
  await registerFeatures([eventsFeature, notificationsFeature]);
  ({ a, b } = await createSchoolPair(FEATURES));
  fx = await fixture(a);
});
afterAll(closeDb);

const admin = () => new EventService(a.as.admin);
const teacher = () => new EventService(a.as.teacher);
const family = (userId = fx.annUser) => new EventService(asUser(a, userId, "student"));
const json = (include: object[], exclude: object[] = []) => JSON.stringify({ include, exclude });
const FAMILIES = json([{ type: "families" }]);
const EVERYONE = json([{ type: "everyone" }]);
const OWN = () => json([{ type: "section", id: fx.own }]);
const OTHER = () => json([{ type: "section", id: fx.other }]);
/** An IST wall time `days` from today at `hour`. */
const at = (days: number, hour = 17) => `${addDays(istDay(new Date()), days)}T${String(hour).padStart(2, "0")}:00`;
const make = (o: Record<string, unknown> = {}) => ({ title: "Parents evening", startsAt: at(3), audience: FAMILIES, ...o });
const notes = (id: string, topic?: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.subjectId, id), topic ? eq(notifications.topic, topic as never) : undefined)));
const people = (id: string) => withSchool(a.id, (tx) => tx.select().from(eventPeople).where(eq(eventPeople.eventId, id)));

describe("who may write", () => {
  it("staff with write add events; families, parents and the accountant cannot", async () => {
    await expect(teacher().create(make({ audience: OWN() }))).resolves.toMatchObject({ title: "Parents evening", state: "live" });
    await expect(family().create(make())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EventService(a.as.parent).create(make())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new EventService(a.as.accountant).create(make())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a teacher reaches own sections freely; the whole school or another section needs the office", async () => {
    await expect(teacher().create(make({ audience: EVERYONE }))).rejects.toThrow("Ask the office to add this for the whole school");
    await expect(teacher().create(make({ audience: OTHER() }))).rejects.toThrow("Ask the office");
    await expect(admin().create(make({ audience: EVERYONE }))).resolves.toBeTruthy();
  });

  it("the website flag is for the office and for everyone only", async () => {
    await expect(teacher().create(make({ audience: OWN(), isPublic: "true" }))).rejects.toMatchObject({ fieldErrors: { isPublic: expect.any(String) } });
    await expect(admin().create(make({ audience: FAMILIES, isPublic: "true" }))).rejects.toMatchObject({ fieldErrors: { isPublic: expect.any(String) } });
    await expect(admin().create(make({ audience: EVERYONE, isPublic: "true" }))).resolves.toMatchObject({ isPublic: true });
  });

  it("only the person who added it, or the office, can change, cancel or answer for it", async () => {
    const e = await teacher().create(make({ audience: OWN() }));
    const other = new EventService(asUser(a, fx.teacher2, "teacher"));
    await expect(other.update(e.id, make({ audience: OWN() }))).rejects.toBeInstanceOf(NotFoundError); // another teacher cannot even see it unless invited
    await expect(admin().update(e.id, make({ title: "Office changed it", audience: OWN() }))).resolves.toMatchObject({ title: "Office changed it" });
    const seen = await admin().create(make({ audience: json([{ type: "staff" }]), title: "Staff meeting" }));
    await expect(other.update(seen.id, make({ audience: json([{ type: "staff" }]) }))).rejects.toThrow("Only the person who added");
    await expect(other.cancel(seen.id, { reason: "Not mine" })).rejects.toThrow("Only the person who added");
  });
});

describe("who sees what", () => {
  it("a family sees events addressed to it and its section, not another section, staff-only or drafts", async () => {
    await admin().create(make({ title: "Own section only", audience: OWN() }));
    await admin().create(make({ title: "Other section only", audience: OTHER() }));
    await admin().create(make({ title: "Staff only", audience: json([{ type: "staff" }]) }));
    await admin().create(make({ title: "Hidden draft", audience: FAMILIES, draft: "true" }));
    const ann = (await family().range(new Date(Date.now() - 864e5), new Date(Date.now() + 30 * 864e5))).map((e) => e.title);
    expect(ann).toContain("Own section only");
    expect(ann).not.toContain("Other section only");
    expect(ann).not.toContain("Staff only");
    expect(ann).not.toContain("Hidden draft");
    const cy = (await family(fx.cyUser).upcoming(100)).map((e) => e.title);
    expect(cy).toContain("Other section only");
    expect(cy).not.toContain("Own section only");
    await expect(family().get((await admin().range(new Date(0), new Date(2e12))).find((e) => e.title === "Staff only")!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("drafts are seen by their author and the office only, and freeze nobody", async () => {
    const d = await teacher().create(make({ title: "Teacher draft", audience: OWN(), draft: "true" }));
    expect(d.state).toBe("draft");
    expect(await people(d.id)).toHaveLength(0);
    expect((await teacher().upcoming(100)).map((e) => e.title)).not.toContain("Teacher draft"); // upcoming is for live events
    await expect(teacher().get(d.id)).resolves.toBeTruthy();
    await expect(admin().get(d.id)).resolves.toBeTruthy();
    await expect(new EventService(asUser(a, fx.teacher2, "teacher")).get(d.id)).rejects.toBeInstanceOf(NotFoundError);
    await teacher().publish(d.id);
    expect((await people(d.id)).length).toBeGreaterThan(0);
  });

  it("publishing freezes the people: a student who joins later is not in the list, but everyone-events still reach them", async () => {
    const own = await admin().create(make({ title: "Frozen", audience: OWN() }));
    const everyone = await admin().create(make({ title: "For everyone", audience: EVERYONE }));
    const keys = (await people(own.id)).map((p) => p.name).sort();
    expect(keys).toEqual(["Ann", "Bob", "Nolo"]);
    expect((await family(fx.cyUser).upcoming(100)).map((e) => e.title)).toContain("For everyone");
    expect(everyone.audienceLabel.length).toBeGreaterThan(0);
  });
});

describe("saved groups", () => {
  const group = async (name: string, sectionId: string) => (await withSchool(a.id, (tx) => tx.insert(commGroups).values({ schoolId: a.id, name, audience: { include: [{ type: "section", id: sectionId }], exclude: [] }, shared: true, createdBy: a.users.admin }).returning()))[0]!;
  const retarget = (id: string, sectionId: string) => withSchool(a.id, (tx) => tx.update(commGroups).set({ audience: { include: [{ type: "section", id: sectionId }], exclude: [] } }).where(eq(commGroups.id, id)));

  it("a group is copied into the event when it is added, edited or published: editing the group later changes nobody", async () => {
    const g = await group("Own section", fx.own);
    const viaGroup = json([{ type: "group", id: g.id }]);
    const e = await admin().create(make({ title: "Via group", audience: viaGroup }));
    expect(JSON.stringify(e.audience)).not.toContain("group");
    expect((await people(e.id)).map((p) => p.name).sort()).toEqual(["Ann", "Bob", "Nolo"]);
    await retarget(g.id, fx.other);
    await withSchool(a.id, (tx) => lateJoiners(tx, a.id)); // the nightly job reads the stored audience, not the group
    expect((await people(e.id)).map((p) => p.name).sort()).toEqual(["Ann", "Bob", "Nolo"]);
    // saving the event again with the group takes the group as it is now
    const again = await admin().update(e.id, make({ title: "Via group", audience: viaGroup }));
    expect(again.audience.include).toEqual([{ type: "section", id: fx.other }]);
    expect((await people(e.id)).map((p) => p.name)).toEqual(["Cy"]);
    // a draft keeps what it was given, and publishing does not re-read the group
    const d = await admin().create(make({ title: "Draft via group", audience: json([{ type: "group", id: g.id }]), draft: "true" }));
    await retarget(g.id, fx.own);
    await admin().publish(d.id);
    expect((await people(d.id)).map((p) => p.name)).toEqual(["Cy"]);
  });
});

describe("files", () => {
  const bytes = (...xs: (number | string)[]) => Uint8Array.from(xs.flatMap((x) => (typeof x === "number" ? [x] : [...x].map((c) => c.charCodeAt(0)))));
  const file = (name: string, type: string, body: Uint8Array) => ({ name, type, size: body.length, bytes: body });

  it("the bytes decide what a file is: a page or a picture dressed as a PDF is refused", async () => {
    const e = await admin().create(make({ audience: OWN() }));
    await expect(admin().attach(e.id, [file("fees.pdf", "application/pdf", bytes("<html><script>alert(1)</script></html>"))])).rejects.toBeInstanceOf(ValidationError);
    await expect(admin().attach(e.id, [file("fees.pdf", "application/pdf", bytes(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10))])).rejects.toBeInstanceOf(ValidationError);
    expect(await admin().files(e.id)).toHaveLength(0);
    expect(await admin().attach(e.id, [file("fees.pdf", "application/pdf", bytes("%PDF-1.7\n%done\n"))])).toBe(1);
  });

  it("is served with its stored type and a disposition: PDFs open, a sheet downloads; only people who may see the event get it", async () => {
    const e = await admin().create(make({ audience: OWN() }));
    await admin().attach(e.id, [file("Fees list.pdf", "application/pdf", bytes("%PDF-1.7\n")), file("names.csv", "text/csv", bytes("name,class\nAnn,5A\n"))]);
    const all = await admin().files(e.id);
    const [pdf, csv] = [all.find((f) => f.fileName.endsWith(".pdf")), all.find((f) => f.fileName.endsWith(".csv"))];
    const got = await family().fileContent(pdf!.id);
    expect(got).toMatchObject({ type: "application/pdf" });
    expect(got.disposition).toMatch(/^inline; filename="Fees list.pdf"/);
    expect(Buffer.from(got.bytes).toString()).toContain("%PDF");
    expect((await family().fileContent(csv!.id)).disposition).toMatch(/^attachment; filename="names.csv"/);
    await expect(family(fx.cyUser).fileContent(pdf!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new EventService({ ...a.as.admin, supportStaffId: "00000000-0000-4000-8000-000000000009" }).fileContent(pdf!.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("telling people", () => {
  it("notify on create tells each login once, never the author; no notify tells nobody", async () => {
    const e = await admin().create(make({ title: "Told", audience: FAMILIES }));
    const rows = await notes(e.id, "event.invite");
    expect(rows.map((r) => r.userId).sort()).toEqual([fx.annUser, fx.bobUser, fx.cyUser].sort());
    const quiet = await admin().create(make({ title: "Quiet", audience: FAMILIES, notify: "false" }));
    expect(await notes(quiet.id)).toHaveLength(0);
  });

  it("a change of time or place tells the whole audience once and raises the sequence; a small edit does not tell", async () => {
    const e = await admin().create(make({ title: "Moves", audience: FAMILIES, location: "Hall" }));
    const before = await notes(e.id, "event.changed");
    expect(before).toHaveLength(0);
    const moved = await admin().update(e.id, make({ title: "Moves", audience: FAMILIES, location: "Ground", startsAt: at(3, 18) }));
    expect(moved.sequence).toBe(1);
    expect((await notes(e.id, "event.changed")).map((r) => r.userId).sort()).toEqual([fx.annUser, fx.bobUser, fx.cyUser].sort());
    const small = await admin().update(e.id, make({ title: "Moves again", audience: FAMILIES, location: "Ground", startsAt: at(3, 18) }));
    expect(small.sequence).toBe(2);
    expect(await notes(e.id, "event.changed")).toHaveLength(3);
    const same = await admin().update(e.id, make({ title: "Moves again", audience: FAMILIES, location: "Ground", startsAt: at(3, 18) }));
    expect(same.sequence).toBe(2);
  });

  it("cancel needs a reason, tells everyone once, keeps the event struck through, and ends editing", async () => {
    const e = await admin().create(make({ title: "Cancelled day", audience: FAMILIES }));
    await expect(admin().cancel(e.id, { reason: "" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    const c = await admin().cancel(e.id, { reason: "Heavy rain" });
    expect(c).toMatchObject({ state: "cancelled", cancelReason: "Heavy rain", sequence: 1 });
    expect(await notes(e.id, "event.changed")).toHaveLength(3);
    expect((await family().range(new Date(Date.now() - 864e5), new Date(Date.now() + 30 * 864e5))).find((x) => x.id === e.id)?.state).toBe("cancelled");
    expect((await family().upcoming(100)).map((x) => x.id)).not.toContain(e.id);
    await expect(admin().update(e.id, make({ audience: FAMILIES }))).rejects.toBeInstanceOf(ConflictError);
    await expect(admin().cancel(e.id, { reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only drafts are deleted; anything told must be cancelled", async () => {
    const live = await admin().create(make({ audience: FAMILIES }));
    await expect(admin().remove(live.id)).rejects.toThrow("Only drafts can be deleted");
    const d = await admin().create(make({ audience: FAMILIES, draft: "true" }));
    await expect(admin().remove(d.id)).resolves.toEqual({ id: d.id });
  });

  it("changing the audience tells only the people added and drops the ones removed", async () => {
    const e = await admin().create(make({ title: "Grows", audience: OWN() }));
    expect((await notes(e.id, "event.invite")).map((r) => r.userId).sort()).toEqual([fx.annUser, fx.bobUser].sort());
    await admin().update(e.id, make({ title: "Grows", audience: json([{ type: "section", id: fx.own }, { type: "section", id: fx.other }]) }));
    expect((await notes(e.id, "event.invite")).map((r) => r.userId).sort()).toEqual([fx.annUser, fx.bobUser, fx.cyUser].sort());
    await admin().update(e.id, make({ title: "Grows", audience: json([{ type: "section", id: fx.other }]) }));
    expect((await people(e.id)).map((p) => p.name)).toEqual(["Cy"]);
    await expect(family().get(e.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opening an event clears its bell row", async () => {
    const e = await admin().create(make({ audience: FAMILIES }));
    expect((await notes(e.id))[0]!.readAt).toBeNull();
    await family().detail(e.id);
    const mine = (await notes(e.id)).find((r) => r.userId === fx.annUser)!;
    expect(mine.readAt).not.toBeNull();
    expect((await notes(e.id)).find((r) => r.userId === fx.bobUser)!.readAt).toBeNull();
  });
});

describe("the website", () => {
  it("publicEvents never lists a non-everyone, draft, cancelled or past event, whoever asks", async () => {
    const open = await admin().create(make({ title: "Open day", audience: EVERYONE, isPublic: "true", startsAt: at(9) }));
    const gone = await admin().create(make({ title: "Called off", audience: EVERYONE, isPublic: "true", startsAt: at(9) }));
    await admin().cancel(gone.id, { reason: "Weather" });
    await admin().create(make({ title: "Private day", audience: EVERYONE, startsAt: at(9) }));
    // Even with the flag forced on in the database, a families-only event stays off.
    const leak = await admin().create(make({ title: "Forced flag", audience: FAMILIES, startsAt: at(9) }));
    await withSchool(a.id, (tx) => tx.update(events).set({ isPublic: true }).where(eq(events.id, leak.id)));
    const excl = await admin().create(make({ title: "Everyone but Ann", audience: json([{ type: "everyone" }], [{ type: "student", id: fx.ann }]), startsAt: at(9) }));
    await withSchool(a.id, (tx) => tx.update(events).set({ isPublic: true }).where(eq(events.id, excl.id)));
    const titles = (await admin().publicEvents(50)).map((e) => e.title);
    expect(titles).toContain("Open day");
    for (const t of ["Called off", "Private day", "Forced flag", "Everyone but Ann"]) expect(titles).not.toContain(t);
    expect(open.isPublic).toBe(true);
  });
});

describe("views and ranges (IST)", () => {
  it("month, week and year ranges include what touches them across month ends and all-day spans", async () => {
    const mk = (title: string, startsAt: string, extra: Record<string, unknown> = {}) => admin().create({ title, startsAt, audience: FAMILIES, notify: "false", ...extra });
    await mk("Late Jan night", "2031-01-31T23:30");
    await mk("Early Feb", "2031-02-01T00:30");
    await mk("Span Jan to Feb", "2031-01-30", { endsAt: "2031-02-02", allDay: "true" });
    await mk("Only March", "2031-03-10T10:00");
    const titles = async (view: "month" | "week" | "year", anchor: string) => {
      const r = viewRange(view, anchor);
      return (await admin().range(r.from, r.to)).map((e) => e.title);
    };
    const jan = await titles("month", "2031-01-15"), feb = await titles("month", "2031-02-15");
    expect(jan).toEqual(expect.arrayContaining(["Late Jan night", "Span Jan to Feb"]));
    expect(jan).not.toContain("Early Feb");
    expect(feb).toEqual(expect.arrayContaining(["Early Feb", "Span Jan to Feb"]));
    expect(feb).not.toContain("Late Jan night");
    expect(await titles("week", "2031-01-29")).toEqual(expect.arrayContaining(["Late Jan night", "Span Jan to Feb"])); // Mon 27 Jan to Sun 2 Feb
    expect(await titles("week", "2031-02-04")).not.toContain("Span Jan to Feb"); // the span ended on the 2nd
    const year = await titles("year", "2031-06-01");
    expect(year).toEqual(expect.arrayContaining(["Late Jan night", "Early Feb", "Only March"]));
    expect(await titles("year", "2030-06-01")).not.toContain("Late Jan night");
    expect(await admin().month("2031-03")).toHaveLength(1);
    await expect(admin().month("2031-13")).rejects.toMatchObject({ code: "validation" });
  });
});

describe("repeat", () => {
  const series = (id: string) => withSchool(a.id, (tx) => tx.select().from(events).where(eq(events.seriesId, id)).orderBy(events.startsAt));
  const weekly = async (o: Record<string, unknown> = {}) => {
    const first = await admin().create(make({ title: "Choir", audience: FAMILIES, startsAt: at(7, 15), repeat: "weekly", repeatUntil: addDays(istDay(new Date()), 7 + 21), notify: "false", ...o }));
    return { first, rows: await series(first.seriesId!) };
  };

  it("makes one row per date, each with its own frozen people", async () => {
    const { rows } = await weekly();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
    for (const r of rows) expect(await people(r.id)).toHaveLength(4); // Ann, Bob, Cy and Nolo, who has no login yet
    expect(rows.map((r) => istDay(r.startsAt))).toEqual([0, 7, 14, 21].map((n) => addDays(istDay(new Date()), 7 + n)));
  });

  it("tells people once for the whole series", async () => {
    const e = await admin().create(make({ title: "Told once", audience: FAMILIES, startsAt: at(7), repeat: "weekly", repeatUntil: addDays(istDay(new Date()), 28) }));
    expect(await notes(e.id, "event.invite")).toHaveLength(3);
  });

  it("fortnightly and monthly dates; a 31st clamps to the end of short months", async () => {
    const f = await admin().create(make({ title: "Fortnightly", startsAt: "2032-01-05T10:00", repeat: "fortnightly", repeatUntil: "2032-02-20", notify: "false" }));
    expect((await series(f.seriesId!)).map((r) => istDay(r.startsAt))).toEqual(["2032-01-05", "2032-01-19", "2032-02-02", "2032-02-16"]);
    const m = await admin().create(make({ title: "Monthly", startsAt: "2032-01-31T10:00", repeat: "monthly", repeatUntil: "2032-04-30", notify: "false" }));
    expect((await series(m.seriesId!)).map((r) => istDay(r.startsAt))).toEqual(["2032-01-31", "2032-02-29", "2032-03-31", "2032-04-30"]);
  });

  it("stops at 60 dates and says so instead of quietly cutting", async () => {
    await expect(admin().create(make({ startsAt: "2033-01-03T10:00", repeat: "weekly", repeatUntil: "2035-01-01" }))).rejects.toMatchObject({ fieldErrors: { repeatUntil: expect.stringContaining("60") } });
    const ok = await admin().create(make({ startsAt: "2033-01-03T10:00", repeat: "weekly", repeatUntil: "2034-02-20", notify: "false" })); // 60 Mondays
    expect(await series(ok.seriesId!)).toHaveLength(60);
  });

  it("can skip days the school is closed (Sundays and holidays), taken from attendance", async () => {
    await withSchool(a.id, (tx) => tx.insert(attendanceHolidays).values({ schoolId: a.id, date: "2034-03-14", name: "Holi", kind: "national" }));
    const tue = await admin().create(make({ title: "Tuesdays", startsAt: "2034-03-07T08:00", repeat: "weekly", repeatUntil: "2034-03-21", skipClosed: "true", notify: "false" }));
    expect((await series(tue.seriesId!)).map((r) => istDay(r.startsAt))).toEqual(["2034-03-07", "2034-03-21"]); // the 14th is Holi
    const all = await admin().create(make({ title: "Tuesdays again", startsAt: "2034-03-07T08:00", repeat: "weekly", repeatUntil: "2034-03-21", notify: "false" }));
    expect(await series(all.seriesId!)).toHaveLength(3); // without the option, nothing is skipped
    await expect(admin().create(make({ startsAt: "2034-03-12T08:00", repeat: "weekly", repeatUntil: "2034-03-26", skipClosed: "true" }))).rejects.toMatchObject({ fieldErrors: { repeatUntil: expect.stringContaining("closed") } }); // all Sundays
  });

  it("edit this one, this and later, or all; moving by an hour moves every date it reaches", async () => {
    const { rows } = await weekly({ title: "Choir A" });
    const change = (extra: Record<string, unknown>) => make({ title: "Choir A", audience: FAMILIES, startsAt: at(7, 15), ...extra });
    await admin().update(rows[1]!.id, make({ title: "Choir B", audience: FAMILIES, startsAt: istDay(rows[1]!.startsAt) + "T16:00" }), "this");
    let now = await series(rows[0]!.seriesId!);
    expect(now.map((r) => r.title)).toEqual(["Choir A", "Choir B", "Choir A", "Choir A"]);
    await admin().update(rows[2]!.id, make({ title: "Choir C", audience: FAMILIES, startsAt: istDay(rows[2]!.startsAt) + "T15:00" }), "later");
    now = await series(rows[0]!.seriesId!);
    expect(now.map((r) => r.title)).toEqual(["Choir A", "Choir B", "Choir C", "Choir C"]);
    await admin().update(rows[0]!.id, change({ title: "Choir All", startsAt: istDay(rows[0]!.startsAt) + "T14:00" }), "all");
    now = await series(rows[0]!.seriesId!);
    expect(now.map((r) => r.title)).toEqual(Array(4).fill("Choir All"));
    expect(now.map((r) => toInputValue(r.startsAt).slice(11))).toEqual(["14:00", "15:00", "14:00", "14:00"]); // the one-off 16:00 moved with the rest
  });

  it("a cancelled occurrence stays cancelled when the series is edited or cancelled again", async () => {
    const { rows } = await weekly({ title: "Drama" });
    await admin().cancel(rows[1]!.id, { reason: "Teacher away" });
    await admin().update(rows[0]!.id, make({ title: "Drama 2", audience: FAMILIES, startsAt: istDay(rows[0]!.startsAt) + "T15:00" }), "all");
    let now = await series(rows[0]!.seriesId!);
    expect(now.map((r) => [r.title, r.state])).toEqual([["Drama 2", "live"], ["Drama", "cancelled"], ["Drama 2", "live"], ["Drama 2", "live"]]);
    await admin().cancel(rows[0]!.id, { reason: "Term over", scope: "all" });
    now = await series(rows[0]!.seriesId!);
    expect(now.every((r) => r.state === "cancelled")).toBe(true);
    expect(now[1]!.cancelReason).toBe("Teacher away");
  });

  it("deleting a draft series removes every draft date", async () => {
    const d = await admin().create(make({ audience: FAMILIES, draft: "true", startsAt: at(7), repeat: "weekly", repeatUntil: addDays(istDay(new Date()), 21) }));
    await admin().remove(d.id, "all");
    expect(await series(d.seriesId!)).toHaveLength(0);
  });
});

describe("late joiners", () => {
  it("adds new people silently, drops those who left unless they answered, rerun adds none", async () => {
    const e = await admin().create(make({ audience: OWN(), rsvpOn: "true" }));
    const [dee] = await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, name: "Dee", admissionNo: `E-${a.slug}-Dee`, classId: null, sectionId: fx.own, userId: null }).returning());
    const before = (await notes(e.id)).length;
    const run = (id = a.id, school = a) => withSchool(id, (tx) => lateJoiners(tx, school.id));
    expect((await run()).added).toBeGreaterThan(0);
    expect((await people(e.id)).some((p) => p.studentId === dee!.id)).toBe(true);
    expect((await notes(e.id)).length).toBe(before);
    expect(await run()).toEqual({ added: 0, removed: 0 });
    await withSchool(a.id, (tx) => tx.update(eventPeople).set({ answer: "yes" }).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.studentId, fx.bob))));
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left" as never }).where(and(eq(students.id, fx.bob))));
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left" as never }).where(eq(students.id, dee!.id)));
    expect((await run()).removed).toBeGreaterThanOrEqual(1);
    const left = await people(e.id);
    expect(left.some((p) => p.studentId === dee!.id)).toBe(false);
    expect(left.some((p) => p.studentId === fx.bob)).toBe(true);
    await expect(family(fx.bobUser).get(e.id)).rejects.toBeInstanceOf(NotFoundError);
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "active" as never }).where(eq(students.id, fx.bob)));
  });

  it("only touches its own school", async () => {
    const e = await admin().create(make({ audience: OWN() }));
    await withSchool(b.id, (tx) => lateJoiners(tx, b.id));
    expect((await people(e.id)).length).toBeGreaterThan(0);
  });
});

describe("isolation", () => {
  it("school B sees, changes and counts nothing of school A", async () => {
    const e = await admin().create(make({ title: "A only", audience: EVERYONE, isPublic: "true" }));
    const bAdmin = new EventService(b.as.admin);
    expect((await bAdmin.range(new Date(0), new Date(2e12))).some((r) => r.id === e.id)).toBe(false);
    expect((await bAdmin.publicEvents(100)).some((r) => r.id === e.id)).toBe(false);
    await expect(bAdmin.get(e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.update(e.id, make({ audience: EVERYONE }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.cancel(e.id, { reason: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.remove(e.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a support session cannot read the people or answers", async () => {
    const e = await admin().create(make({ audience: FAMILIES, rsvpOn: "true" }));
    const d = await new EventService({ ...a.as.admin, supportStaffId: "00000000-0000-4000-8000-000000000009" }).detail(e.id);
    expect(d.me).toBeNull();
    expect(d.counts).toBeNull();
  });
});
