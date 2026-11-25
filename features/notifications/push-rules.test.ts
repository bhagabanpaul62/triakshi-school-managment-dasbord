import { describe, expect, it } from "vitest";
import { mayAskForPush } from "./push-rules";

describe("mayAskForPush", () => {
  it("asks once, only where alerts can be turned on, never on sign-in", () => {
    expect(mayAskForPush("ready", "/app/notifications/abc", false)).toBe(true);
    expect(mayAskForPush("ready", "/app/notifications/abc", true)).toBe(false);
    for (const m of ["off", "on", "blocked", "unsupported", "iphone", "loading"]) expect(mayAskForPush(m, "/app", false)).toBe(false);
    for (const p of ["/login", "/login/otp", "/forgot-password", "/reset-password", "/support-login"]) expect(mayAskForPush("ready", p, false)).toBe(false);
  });
});
