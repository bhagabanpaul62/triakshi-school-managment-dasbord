import { describe, expect, it } from "vitest";
import { auditChanges } from "./index";

describe("auditChanges", () => {
  it("records old and new text for ordinary fields", () => {
    expect(auditChanges({ phone: "98", name: "A" }, { phone: "99", name: "A" })).toEqual({ phone: ["98", "99"] });
  });

  it("never records the words of medical, pay, secret or bank fields", () => {
    const before = { medicalNotes: "asthma", bloodGroup: "A+", salaryNote: "40000", bankLast4: "1234", panSealed: "x", passwordHash: "h", privateNote: "p" };
    const after = Object.fromEntries(Object.keys(before).map((k) => [k, "changed"]));
    const out = auditChanges(before, after);
    expect(Object.keys(out).sort()).toEqual(Object.keys(before).sort());
    for (const v of Object.values(out)) expect(v).toEqual(["(hidden)", "(hidden)"]);
  });

  it("hides the extra fields a service names", () => {
    expect(auditChanges({ religion: "x" }, { religion: "y" })).toEqual({ religion: ["x", "y"] });
    expect(auditChanges({ religion: "x" }, { religion: "y" }, ["religion"])).toEqual({ religion: ["(hidden)", "(hidden)"] });
  });
});
