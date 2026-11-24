import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, pdfInfo, pdfPageCount, useServices } from "@smw/integrations";
import { defaultConfig, sampleData } from "./config";
import { DUPLICATE, logPrint, withCopyMark } from "./prints";
import { TemplateService } from "./service";

let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => { ({ a, b } = await createSchoolPair(["finance"], "-tpl")); useServices({ storage }); });
afterAll(closeDb);

const svc = (s: TestSchool, who: keyof TestSchool["as"] = "admin") => new TemplateService(s.as[who]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4ISd3Qk6OAUIBAB8mBBGFRCvEAAAAAElFTkSuQmCC", "base64");

describe("versions", () => {
  it("starts on the built-in layout, with the school's own name in the header", async () => {
    const cur = await svc(a).current("receipt");
    expect([cur.version, cur.isDefault, cur.config.headerLines[0]]).toEqual([0, true, "School A-TPL"]);
    expect((await svc(a).list()).every((k) => k.isDefault)).toBe(true);
  });

  it("every save is a new version; saving the same thing again is not", async () => {
    const s = svc(a);
    const base = (await s.current("receipt")).config;
    expect((await s.save("receipt", { ...base, layout: "a4", title: "Receipt A4" })).version).toBe(1);
    expect((await s.save("receipt", { ...base, layout: "a4", title: "Receipt A4" })).version).toBe(1);
    expect((await s.save("receipt", { ...base, layout: "thermal80", title: "Roll receipt" })).version).toBe(2);
    expect((await s.versions("receipt")).map((v) => [v.version, v.isCurrent])).toEqual([[2, true], [1, false]]);
    expect((await s.current("receipt")).config.title).toBe("Roll receipt");
    expect((await s.current("invoice")).version).toBe(0);
  });

  it("restore makes an old version current as a new one; the old rows stay as they were", async () => {
    const s = svc(a);
    const r = await s.restore("receipt", 1);
    expect([r.version, r.config.title]).toEqual([3, "Receipt A4"]);
    expect((await s.version("receipt", 2)).config.title).toBe("Roll receipt");
    expect((await s.versions("receipt")).filter((v) => v.isCurrent).map((v) => v.version)).toEqual([3]);
    await expect(s.restore("receipt", 99)).rejects.toThrow(NotFoundError);
  });

  it("an old version still renders as it was issued", async () => {
    const s = svc(a);
    const old = await s.render("receipt", sampleData("receipt"), { version: 2 });
    const now = await s.render("receipt", sampleData("receipt"));
    expect(await pdfPageCount(old)).toBe(1);
    // 80 mm roll against A4: a very different page box.
    expect((await pdfInfo(old)).width).toBeCloseTo(226.77, 1);
    expect((await pdfInfo(now)).width).toBeCloseTo(595.28, 1);
  });

  it("reset saves the built-in layout as a new version", async () => {
    const s = svc(a);
    const r = await s.reset("receipt");
    expect(r.version).toBe(4);
    expect(r.config).toEqual(defaultConfig("receipt", r.config.headerLines));
    expect((await s.version("receipt", 3)).config.title).toBe("Receipt A4");
  });

  it("version 0 is the built-in layout and an unknown version is not found", async () => {
    expect((await svc(a).version("voucher", 0)).isDefault).toBe(true);
    await expect(svc(a).version("voucher", 5)).rejects.toThrow(NotFoundError);
  });
});

describe("who may do what", () => {
  it("accountants read and print a sample but cannot change anything", async () => {
    const acc = svc(a, "accountant");
    expect((await acc.current("receipt")).version).toBe(4);
    expect(await pdfPageCount(await acc.sample("receipt", defaultConfig("receipt", ["X"])))).toBe(1);
    expect((await acc.editorContext()).canEdit).toBe(false);
    const cfg = defaultConfig("receipt", ["X"]);
    await expect(acc.save("receipt", cfg)).rejects.toThrow(ForbiddenError);
    await expect(acc.reset("receipt")).rejects.toThrow(ForbiddenError);
    await expect(acc.restore("receipt", 1)).rejects.toThrow(ForbiddenError);
    await expect(acc.uploadImage("logo", { name: "l.png", type: "image/png", size: PNG.length, bytes: PNG })).rejects.toThrow(ForbiddenError);
  });
  it("teachers, students and parents see nothing", async () => {
    for (const who of ["teacher", "student", "parent"] as const) await expect(svc(a, who).current("receipt")).rejects.toThrow(ForbiddenError);
  });
});

describe("isolation and images", () => {
  it("another school has its own versions", async () => {
    expect((await svc(b).versions("receipt"))).toHaveLength(0);
    expect((await svc(b).current("receipt")).config.headerLines[0]).toBe("School B-TPL");
  });
  it("uploads land under the school and render; another school's image is refused", async () => {
    const { url } = await svc(a).uploadImage("signature", { name: "Sig.PNG", type: "image/png", size: PNG.length, bytes: PNG });
    expect(url.startsWith(`/api/files/${a.id}/finance-docs/signature/`)).toBe(true);
    const base = (await svc(a).current("receipt")).config;
    const saved = await svc(a).save("receipt", { ...base, signature: { name: "Head", title: "Principal", imageUrl: url } });
    expect(saved.version).toBe(5);
    expect(await pdfPageCount(await svc(a).render("receipt", sampleData("receipt")))).toBe(1);
    await expect(svc(b).save("receipt", { ...(await svc(b).current("receipt")).config, signature: { name: "H", title: "P", imageUrl: url } })).rejects.toThrow(ValidationError);
    await expect(svc(a).uploadImage("logo", { name: "x.exe", type: "application/x-msdownload", size: 3, bytes: new Uint8Array(3) })).rejects.toThrow(ValidationError);
  });
  it("a missing image file does not stop the document printing", async () => {
    const base = (await svc(a).current("receipt")).config;
    await svc(a).save("receipt", { ...base, logoUrl: `/api/files/${a.id}/finance-docs/logo/gone.png` });
    expect(await pdfPageCount(await svc(a).render("receipt", sampleData("receipt")))).toBe(1);
  });
  it("bad config is refused with field messages", async () => {
    await expect(svc(a).save("receipt", { layout: "a3" })).rejects.toThrow(ValidationError);
  });
});

describe("prints", () => {
  it("numbers copies 1, 2, 3 per document and marks DUPLICATE from copy 2", async () => {
    const docId = crypto.randomUUID(), other = crypto.randomUUID();
    const log = (id: string) => withSchool(a.id, (tx) => logPrint(tx, { docType: "receipt", docId: id, userId: a.users.admin }));
    expect([await log(docId), await log(docId), await log(other), await log(docId)]).toEqual([1, 2, 1, 3]);
    const d = sampleData("receipt");
    expect(withCopyMark(d, 1).marks).toEqual([]);
    expect(withCopyMark(d, 2).marks).toEqual([DUPLICATE]);
    expect(withCopyMark(withCopyMark({ ...d, marks: ["REVERSED"] }, 2), 3).marks).toEqual(["REVERSED", DUPLICATE]);
  });
  it("print() logs and returns the copy number; copies are per school", async () => {
    const o = { docType: "receipt", docId: crypto.randomUUID() };
    expect((await svc(a).print("receipt", sampleData("receipt"), o)).copyNo).toBe(1);
    const second = await svc(a).print("receipt", sampleData("receipt"), o);
    expect(second.copyNo).toBe(2);
    expect(await pdfPageCount(second.bytes)).toBe(1);
    expect((await svc(b).print("receipt", sampleData("receipt"), o)).copyNo).toBe(1);
  });
});
