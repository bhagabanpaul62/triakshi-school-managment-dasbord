import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, ReadOnlyError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "./feature";
import { CommSettingsService, commSettingsSchema, loadCommSettings } from "./settings";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"], "s"));
});
afterAll(closeDb);

describe("comm settings", () => {
  it("fills every default when nothing is saved", async () => {
    const s = await new CommSettingsService(a.as.teacher).get();
    expect(s).toMatchObject({
      quietFrom: "20:00", quietTo: "07:00", quietSundays: true, teacherPublish: "free", approvalFor: { families: false, wholeSchool: false, website: true },
      familiesMayStart: true, familiesMayReply: true, teacherMessages: "taught", attachments: true, showStaffSeen: true,
      circularFormat: "CIR/{session}/{n}", requestFormat: "REQ/{session}/{n}", languages: [], channelDefaults: {}, retentionYears: 3, safetyContacts: [], officeName: "School office",
    });
  });

  it("saves only what changed, audits it, and keeps the rest", async () => {
    const svc = new CommSettingsService(a.as.admin);
    const saved = await svc.save({ quietFrom: "21:00", languages: ["Hindi"], channelDefaults: { fees: { push: true, email: "instant" } }, safetyContacts: [{ name: "Childline", phone: "1098" }] });
    expect(saved.quietFrom).toBe("21:00");
    expect(saved.quietTo).toBe("07:00");
    await svc.save({ retentionYears: 5 });
    const again = await new CommSettingsService(a.as.accountant).get();
    expect(again).toMatchObject({ quietFrom: "21:00", retentionYears: 5, languages: ["Hindi"], channelDefaults: { fees: { push: true, email: "instant" } }, safetyContacts: [{ name: "Childline", phone: "1098" }] });
    const [log] = [...(await withSchool(a.id, (tx) => tx.execute(sql`select count(*)::int as n from audit_logs where module = 'notifications' and entity = 'Communication settings'`)))] as { n: number }[];
    expect(log!.n).toBe(2);
  });

  it("refuses bad values with field errors", async () => {
    const svc = new CommSettingsService(a.as.admin);
    await expect(svc.save({ quietFrom: "8pm" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ retentionYears: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ retentionYears: 8 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ circularFormat: "CIR/no-number" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ teacherPublish: "never" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ channelDefaults: { nonsense: { push: true, email: "off" } } })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.get()).retentionYears).toBe(5);
  });

  it("only admins save; read-only schools refuse", async () => {
    await expect(new CommSettingsService(a.as.teacher).save({ officeName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CommSettingsService({ ...a.as.admin, readOnly: true }).save({ officeName: "x" })).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await new CommSettingsService(a.as.student).get()).officeName).toBe("School office");
  });

  it("one school's settings never reach another", async () => {
    expect((await new CommSettingsService(b.as.admin).get()).retentionYears).toBe(3);
    await new CommSettingsService(b.as.admin).save({ officeName: "B office" });
    expect((await new CommSettingsService(a.as.admin).get()).officeName).toBe("School office");
  });

  it("a damaged row falls back to defaults", async () => {
    await withSchool(b.id, (tx) => tx.execute(sql`update comm_settings set settings = '{"retentionYears": 99}'::jsonb`));
    expect((await withSchool(b.id, loadCommSettings)).retentionYears).toBe(3);
    expect(commSettingsSchema.parse({}).quietSundays).toBe(true);
  });
});
