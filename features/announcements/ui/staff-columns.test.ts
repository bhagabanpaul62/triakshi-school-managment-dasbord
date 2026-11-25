import { describe, expect, it } from "vitest";
import { answeredText, LIST_COLUMNS, listRow, rowStep } from "./staff-columns";
import type { NoticeRow } from "../notice-service";

const row = (o: Partial<NoticeRow> = {}): NoticeRow => ({
  id: "1", type: "notice", number: null, title: "Trip", state: "published", categoryId: null, categoryName: null, categoryTone: null, audienceLabel: "Class 5 A", authorId: null, authorName: "Asha",
  publishedAt: new Date("2026-06-01T05:00:00Z"), scheduledAt: null, sendAt: null, expiresAt: null, dueAt: null, responseKind: "consent", withdrawReason: null, version: 1, correctedAt: null,
  updatedAt: new Date("2026-06-01T05:00:00Z"), recipients: 40, seen: 30, answered: 12, ...o,
});

describe("the staff list", () => {
  it("has at most five columns and none that formats the answered text as a number", () => {
    expect(LIST_COLUMNS.length).toBeLessThanOrEqual(5);
    expect(LIST_COLUMNS.find((c) => c.key === "answers")?.type).toBeUndefined();
  });

  it("shows the title as text with its kind under it, never as a person with initials", () => {
    expect(LIST_COLUMNS.find((c) => c.key === "title")).toMatchObject({ type: "text", metaKey: "meta" });
  });

  it("answered reads '12 of 40', and is empty, never NaN, when nothing is asked or nobody got it", () => {
    expect(answeredText(row())).toBe("12 of 40");
    expect(answeredText(row({ responseKind: "none" }))).toBeNull();
    expect(answeredText(row({ recipients: 0, answered: 0 }))).toBeNull();
    expect(JSON.stringify(listRow(row()))).not.toContain("NaN");
  });

  it("puts the kind and number under the title and the writer under the date", () => {
    const r = listRow(row({ type: "circular", number: "CIR/2026-27/003" }));
    expect(r.meta).toBe("Circular · CIR/2026-27/003");
    expect(r.when).toMatch(/· Asha$/);
    expect(listRow(row({ type: "circular", state: "draft", number: null })).meta).toContain("number given when it goes out");
  });

  it("offers a step only to a draft and to one waiting for review", () => {
    expect(rowStep("draft")).toMatchObject({ label: "Keep writing", to: "edit" });
    expect(rowStep("waiting")).toMatchObject({ label: "Review" });
    for (const s of ["scheduled", "sending", "published", "expired", "withdrawn"] as const) expect(rowStep(s)).toBeNull();
  });
});
