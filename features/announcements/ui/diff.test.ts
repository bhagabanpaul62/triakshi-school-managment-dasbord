import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("marks what the approver removed and added and keeps the rest", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([{ kind: "same", text: "a" }, { kind: "removed", text: "b" }, { kind: "added", text: "B" }, { kind: "same", text: "c" }]);
    expect(diffLines("same", "same").every((l) => l.kind === "same")).toBe(true);
  });
});
