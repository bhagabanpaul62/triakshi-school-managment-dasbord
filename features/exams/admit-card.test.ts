import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage, useServices } from "@smw/integrations";
import { AdmitCardLayout, type AdmitCard } from "./admit-card";

const storage = new MemoryStorage();
beforeAll(() => { useServices({ storage }); });
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4ISd3Qk6OAUIBAB8mBBGFRCvEAAAAAElFTkSuQmCC", "base64"));
const images = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;
const card = (n: number, photoKey: string | null): AdmitCard => ({
  school: { name: "School" } as AdmitCard["school"], examName: "Unit 1", yearName: "2026-27",
  student: { name: `S${n}`, admissionNo: `A${n}`, rollNo: n, className: "Class 6", sectionName: "A", dob: null, photoKey },
  papers: [{ date: "2026-10-01", subject: "Maths", startTime: null, endTime: null }],
});

describe("admit card photo", () => {
  it("draws the photo as an image; missing or broken photos keep the box and never fail", async () => {
    await storage.put("s/students/p1.png", PNG, "image/png");
    await storage.put("s/students/bad.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(images(await AdmitCardLayout.render([card(1, "s/students/p1.png")]))).toBe(1);
    const pdf = await AdmitCardLayout.render([card(2, null), card(3, "s/students/gone.png"), card(4, "s/students/bad.png")]);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(images(pdf)).toBe(0);
  });
  it("loads many photos with bounded concurrency", async () => {
    await storage.put("s/students/p1.png", PNG, "image/png");
    const cards = Array.from({ length: 20 }, (_, i) => card(i, "s/students/p1.png"));
    expect(images(await AdmitCardLayout.render(cards))).toBeGreaterThanOrEqual(1);
    expect(cards.every((c) => c.student.photo)).toBe(true);
  });
});
