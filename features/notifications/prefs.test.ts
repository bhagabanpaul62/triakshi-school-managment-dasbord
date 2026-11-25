import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "./feature";
import { PreferenceService, tokenKeyFor } from "./prefs";
import { commSettings, notificationPrefs, pushSubscriptions } from "./schema";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "pf"));
});
afterAll(closeDb);
beforeEach(async () => { for (const s of [a, b]) await withSchool(s.id, async (tx) => { await tx.delete(pushSubscriptions); await tx.delete(notificationPrefs); await tx.delete(commSettings); }); });

const prefs = (s: TestSchool, role: keyof TestSchool["as"], readOnly = false) => new PreferenceService({ ...s.as[role], readOnly });

describe("PreferenceService", () => {
  it("shows the topic default, then the school's, then the person's own choice", async () => {
    const p = prefs(a, "student");
    expect((await p.mine()).groups.notices).toMatchObject({ push: true, email: "digest", own: false, locked: false });
    await withSchool(a.id, (tx) => tx.insert(commSettings).values({ schoolId: a.id, settings: { channelDefaults: { families: { notices: { push: false, email: "off" } } } } }));
    expect((await p.mine()).groups.notices).toMatchObject({ push: false, email: "off", own: false });
    await p.saveGroup({ group: "notices", push: true, email: "instant" });
    await p.saveGroup({ group: "fees", push: false, email: "off" });
    const m = await p.mine();
    expect(m.groups.notices).toMatchObject({ push: true, email: "instant", own: true });
    expect(m.groups.fees).toMatchObject({ push: false, email: "off", own: true });
  });

  it("locked groups cannot be turned off", async () => {
    const p = prefs(a, "student");
    await expect(p.saveGroup({ group: "urgent", push: false, email: "off" })).rejects.toBeInstanceOf(ValidationError);
    await expect(p.saveGroup({ group: "urgent", push: false, email: "off" })).rejects.toBeInstanceOf(ValidationError);
    expect((await p.mine()).groups.urgent).toMatchObject({ push: true, email: "instant", locked: true });
    await expect(p.saveGroup({ group: "nope", push: true, email: "off" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("saves quiet hours, digest time, language and away, each checked", async () => {
    const p = prefs(a, "teacher");
    await p.saveQuiet({ from: "21:30", to: "06:00" });
    await p.saveDigest(8);
    await p.saveLanguage("hi");
    await p.setAway("2030-01-10", "Back on the 10th");
    expect(await p.mine()).toMatchObject({ quietFrom: "21:30", quietTo: "06:00", digestHour: 8, language: "hi", awayUntil: "2030-01-10", awayText: "Back on the 10th" });
    await p.saveQuiet(null);
    await p.setAway(null);
    expect(await p.mine()).toMatchObject({ quietFrom: null, awayUntil: null, awayText: null });
    await expect(p.saveQuiet({ from: "25:00", to: "06:00" })).rejects.toBeInstanceOf(ValidationError);
    await expect(p.saveDigest(12)).rejects.toBeInstanceOf(ValidationError);
    await expect(p.setAway("tomorrow")).rejects.toBeInstanceOf(ValidationError);
  });

  it("works in a read-only school (it is the person's own setting)", async () => {
    await prefs(a, "student", true).saveDigest(8);
    expect((await prefs(a, "student").mine()).digestHour).toBe(8);
  });

  it("lists, adds and removes only my devices", async () => {
    const p = prefs(a, "student");
    await p.subscribe("https://fcm.googleapis.com/fcm/send/abc", "k1", "a1", "Phone");
    await p.subscribe("https://fcm.googleapis.com/fcm/send/abc", "k2", "a2", "Phone");
    await prefs(a, "teacher").subscribe("https://updates.push.services.mozilla.com/wpush/v2/other", "k", "a");
    const mine = await p.devices();
    expect(mine).toHaveLength(1);
    await expect(prefs(a, "teacher").removeDevice(mine[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await p.removeDevice(mine[0]!.id);
    expect(await p.devices()).toHaveLength(0);
    await expect(p.subscribe("http://fcm.googleapis.com/x", "k", "a")).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts only the browsers' own push hosts, over https", async () => {
    const p = prefs(a, "student");
    for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/x", "https://web.push.apple.com/x", "https://wns2-par02p.notify.windows.com/x", "https://a.push.services.mozilla.com/x"])
      await expect(p.subscribe(ok, "k", "a")).resolves.not.toThrow();
    for (const bad of ["https://push.example/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://notapple.com/x", "https://169.254.169.254/x", "https://user:pw@fcm.googleapis.com/x", "https://xfcm.googleapis.com/x"])
      await expect(p.subscribe(bad, "k", "a")).rejects.toBeInstanceOf(ValidationError);
  });

  it("a support session sees the settings but changes nothing and registers no device", async () => {
    const support = new PreferenceService({ ...a.as.student, supportStaffId: crypto.randomUUID() });
    expect((await support.mine()).groups.notices.own).toBe(false);
    await expect(support.saveGroup({ group: "notices", push: false, email: "off" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.saveDigest(8)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.subscribe("https://fcm.googleapis.com/fcm/send/s", "k", "a")).rejects.toBeInstanceOf(ForbiddenError);
    const readOnly = new PreferenceService({ ...a.as.student, supportStaffId: crypto.randomUUID(), readOnly: true });
    await expect(readOnly.setAway("2026-12-01")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prefs(a, "student").devices()).toHaveLength(0);
    expect(await withSchool(a.id, (tx) => tx.select().from(notificationPrefs))).toHaveLength(0);
  });

  it("names the person and the address for the unsubscribe page", async () => {
    const url = await withSchool(a.id, (tx) => PreferenceService.unsubscribeUrlFor(tx, a.id, a.slug, a.users.student));
    const info = await PreferenceService.unsubscribeInfo(a.id, new URL(url!).searchParams.get("t")!);
    expect(info?.email).toBeTruthy();
    expect(info!.person).toBeTruthy();
    expect(info!.others.some((o) => o.name === info!.person)).toBe(false);
    expect(await PreferenceService.unsubscribeInfo(a.id, "wrong-token")).toBeNull();
  });

  it("unsubscribes only the person the link belongs to, without a sign-in", async () => {
    const url = await withSchool(a.id, (tx) => PreferenceService.unsubscribeUrlFor(tx, a.id, a.slug, a.users.student, "notices"));
    await withSchool(a.id, (tx) => PreferenceService.unsubscribeUrlFor(tx, a.id, a.slug, a.users.teacher));
    const token = new URL(url!).searchParams.get("t")!;
    expect(token).toHaveLength(43);
    // the same link is built again for a later email and still works
    expect(await withSchool(a.id, (tx) => PreferenceService.unsubscribeUrlFor(tx, a.id, a.slug, a.users.student))).toContain(token);
    await expect(PreferenceService.unsubscribeByToken(a.id, token, "urgent")).rejects.toBeInstanceOf(ValidationError);
    expect(await PreferenceService.unsubscribeByToken(a.id, "wrong-token")).toBeNull();
    expect(await PreferenceService.unsubscribeByToken(b.id, token)).toBeNull();
    const done = await PreferenceService.unsubscribeByToken(a.id, token, "notices");
    expect(done).toMatchObject({ userId: a.users.student, groups: ["notices"] });
    expect((await prefs(a, "student").mine()).groups.notices).toMatchObject({ email: "off", push: true });
    expect((await prefs(a, "teacher").mine()).groups.notices.email).toBe("digest");
    // no group: every group that may be turned off, never the locked ones
    const all = await PreferenceService.unsubscribeByToken(a.id, token);
    expect(all!.groups).not.toContain("urgent");
    const m = await prefs(a, "student").mine();
    expect(m.groups.fees.email).toBe("off");
    expect(m.groups.urgent.email).toBe("instant");
    expect((await withSchool(a.id, (tx) => tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, a.users.teacher))))[0]!.groups).toEqual({});
  });
});

describe("unsubscribe links without a secret", () => {
  it("are never signed with a fixed key in production", () => {
    expect(tokenKeyFor(undefined, false)).toBeNull();
    expect(tokenKeyFor(undefined, true)).toBe("local-only-data-key");
    expect(tokenKeyFor("x".repeat(32), false)).toBe("x".repeat(32));
  });
});
