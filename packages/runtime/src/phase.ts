import { accessOf, type StudentPhase } from "@smw/auth";

/** What a left or alumni student's login keeps, whatever the school has on. Everything else is refused in one place: the Ctx. */
export const LEFT_FEATURES: readonly string[] = ["fees", "exams", "home", "notifications", "settings"];

/** The pages of /app that a left student's login may open: the modules it keeps. Every other page is one NoAccess page, decided once in requireCtx. */
const LEFT_PATHS = ["/app/fees", "/app/results", "/app/exams", "/app/notifications", "/app/profile", "/app/not-available", "/app/change-password"];
export const NOT_AVAILABLE_PATH = "/app/not-available";
export const leftMayOpen = (path: string) => path === "/app" || LEFT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** The last day a left student's login works, or undefined for everyone else. Goes on the Ctx so a page can say it. */
export function leftUntilOf(phase: StudentPhase | null | undefined, now = new Date()): string | undefined {
  const a = accessOf(phase, now);
  return a.kind === "left" ? a.until : undefined;
}

/**
 * The features a session may use. A left or alumni student (inside the 90 days) gets the school's features
 * intersected with LEFT_FEATURES; everyone else, including a student with no student row, keeps them unchanged.
 * Read-only is not touched: a left family can still pay dues.
 */
export function featuresFor(features: ReadonlySet<string>, phase: StudentPhase | null | undefined, now = new Date()): ReadonlySet<string> {
  return accessOf(phase, now).kind === "left" ? new Set([...features].filter((k) => LEFT_FEATURES.includes(k))) : features;
}

export { mayHear, leftPhases, accessOf, LEFT_TOPIC, type StudentPhase } from "@smw/auth";
