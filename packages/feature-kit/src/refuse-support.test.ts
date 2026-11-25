import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "./errors";
import { refuseSupport } from "./context";

afterEach(() => vi.restoreAllMocks());

describe("refuseSupport", () => {
  it("does nothing in a normal session", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => refuseSupport({ schoolId: "s1", supportStaffId: null }, "read a private thing")).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("in a support session logs school, staff and what (nothing else) and refuses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => refuseSupport({ schoolId: "s1", supportStaffId: "st9" }, "remove a device")).toThrow(ForbiddenError);
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toEqual({ level: "warn", msg: "support session refused", schoolId: "s1", supportStaffId: "st9", what: "remove a device" });
  });
});
