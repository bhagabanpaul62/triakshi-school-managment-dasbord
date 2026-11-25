import { describe, expect, it } from "vitest";
import { ConflictError } from "@smw/feature-kit";
import { NOTICE_STATES } from "./constants";
import { ACTIONS, TRANSITIONS, can, transition } from "./state";

describe("the notice state machine", () => {
  it("allows exactly the moves in the table, and every other pair is refused in plain words", () => {
    for (const state of NOTICE_STATES) {
      for (const action of ACTIONS) {
        const next = TRANSITIONS[state][action];
        if (next === undefined) expect(() => transition(state, action), `${state} ${action}`).toThrowError(ConflictError);
        else expect(transition(state, action)).toBe(next);
      }
    }
  });

  it("follows the story: draft, approval, schedule, sending with undo, published, corrected, withdrawn", () => {
    const walk = (from: Parameters<typeof transition>[0], ...acts: Parameters<typeof transition>[1][]) => acts.reduce((s, a) => transition(s as never, a) as never, from);
    expect(walk("draft", "submit", "approveScheduled", "due", "fanOut", "correct", "withdraw")).toBe("withdrawn");
    expect(walk("draft", "publish", "undo")).toBe("draft");
    expect(walk("draft", "submit", "askChanges", "submit", "approve", "fanOut", "expire", "withdraw")).toBe("withdrawn");
  });

  it("only a draft can be deleted, nothing leaves withdrawn, only a sending notice can be undone", () => {
    expect(NOTICE_STATES.filter((s) => can(s, "delete"))).toEqual(["draft"]);
    expect(Object.keys(TRANSITIONS.withdrawn)).toEqual([]);
    expect(NOTICE_STATES.filter((s) => can(s, "undo"))).toEqual(["sending"]);
    expect(NOTICE_STATES.filter((s) => can(s, "correct"))).toEqual(["published"]);
    expect(() => transition("published", "publish")).toThrowError(/published/);
  });
});
