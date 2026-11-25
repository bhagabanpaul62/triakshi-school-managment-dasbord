import { describe, expect, it } from "vitest";
import { ValidationError } from "@smw/feature-kit";
import { answerText, checkAnswer } from "./answer";
import type { ResponseSpec } from "./constants";

describe("checkAnswer", () => {
  it("consent: a no may need its reason", () => {
    expect(checkAnswer({ kind: "consent", reasonForNo: true }, { kind: "consent", yes: true })).toEqual({ kind: "consent", yes: true });
    expect(() => checkAnswer({ kind: "consent", reasonForNo: true }, { kind: "consent", yes: false })).toThrowError(ValidationError);
    expect(checkAnswer({ kind: "consent", reasonForNo: false }, { kind: "consent", yes: false })).toEqual({ kind: "consent", yes: false });
    expect(answerText({ kind: "consent", yes: false, reason: "away" })).toBe("No: away");
  });
  it("poll: only the options, one unless several are allowed", () => {
    const single: Extract<ResponseSpec, { kind: "poll" }> = { kind: "poll", options: ["A", "B"], multiple: false };
    expect(() => checkAnswer(single, { kind: "poll", choices: ["C"] })).toThrowError(ValidationError);
    expect(() => checkAnswer(single, { kind: "poll", choices: ["A", "B"] })).toThrowError(ValidationError);
    expect(checkAnswer({ ...single, multiple: true }, { kind: "poll", choices: ["A", "B", "A"] })).toEqual({ kind: "poll", choices: ["A", "B"] });
  });
  it("form: required, number, date, choice and yes/no are checked by question", () => {
    const spec: ResponseSpec = { kind: "form", questions: [
      { id: "q1", label: "Size", kind: "choice", required: true, options: ["S", "M"] }, { id: "q2", label: "Age", kind: "number", required: true },
      { id: "q3", label: "Day", kind: "date", required: false }, { id: "q4", label: "OK", kind: "yesno", required: false },
    ] };
    expect(checkAnswer(spec, { kind: "form", values: { q1: "M", q2: "9", q5: "junk" } })).toEqual({ kind: "form", values: { q1: "M", q2: "9" } });
    const bad = () => checkAnswer(spec, { kind: "form", values: { q1: "XL", q2: "nine", q3: "31/12", q4: "maybe" } });
    expect(bad).toThrowError(ValidationError);
    try { bad(); } catch (e) { expect(Object.keys((e as ValidationError).fieldErrors ?? {}).sort()).toEqual(["values.q1", "values.q2", "values.q3", "values.q4"]); }
    expect(() => checkAnswer(spec, { kind: "form", values: {} })).toThrowError(ValidationError);
  });
  it("a different kind, or a notice that asks nothing, is refused", () => {
    expect(() => checkAnswer({ kind: "ack" }, { kind: "consent", yes: true })).toThrowError(ValidationError);
    expect(() => checkAnswer({ kind: "none" }, { kind: "ack" })).toThrowError(ValidationError);
  });
});
