import { describe, expect, it } from "vitest";
import { PdfBuilder } from "./pdf";

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4ISd3Qk6OAUIBAB8mBBGFRCvEAAAAAElFTkSuQmCC";
const JPG = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAHlhf//Z";
const images = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;

describe("PdfBuilder.image", () => {
  it("embeds PNG and JPEG", async () => {
    const b = await PdfBuilder.create();
    const r = { x: 50, top: 700, w: 40, h: 40 };
    expect(await b.image(b64(PNG), r)).toBe(true);
    expect(await b.image(b64(JPG), { ...r, x: 100 })).toBe(true);
    expect(images(await b.save())).toBe(2);
  });
  it("returns false for garbage and keeps the document valid", async () => {
    const b = await PdfBuilder.create();
    expect(await b.image(new Uint8Array([1, 2, 3]), { x: 0, top: 100, w: 10, h: 10 })).toBe(false);
    expect(images(await b.save())).toBe(0);
  });
});
