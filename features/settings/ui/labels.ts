import type { Tone } from "@smw/ui/tone";

/** How roles, account states and modules read and look, shared by every settings screen. */
export const ROLE_LABELS: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher", student: "Student", staff: "Staff" };
export const ROLE_TONES: Record<string, Tone> = { admin: "info", accountant: "warning", teacher: "default", student: "default", staff: "default" };
export const ROLE_KIND_LABELS: Record<string, string> = { system: "Built in", template: "Template", custom: "Custom" };
export const ROLE_KIND_TONES: Record<string, Tone> = { system: "info", template: "warning", custom: "default" };
export const STATUS_LABELS: Record<string, string> = { active: "Active", invited: "Invited", disabled: "Disabled" };
export const STATUS_TONES: Record<string, Tone> = { active: "success", invited: "warning", disabled: "danger" };

/** "fees" → "Fees", "student-docs" → "Student docs". */
export const moduleLabel = (key: string) => key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Sign-in results and ways in, in the words a school office uses. */
export const OUTCOME_LABELS: Record<string, string> = {
  success: "Signed in", bad_password: "Wrong password", bad_code: "Wrong code", unknown_login: "Unknown login",
  disabled: "Account disabled", rate_limited: "Too many tries", support: "Support visit", support_failed: "Support link failed",
};
export const OUTCOME_TONES: Record<string, Tone> = {
  success: "success", bad_password: "warning", bad_code: "warning", unknown_login: "warning", disabled: "danger", rate_limited: "danger", support: "info", support_failed: "warning",
};
export const METHOD_LABELS: Record<string, string> = { password: "Password", code: "Email code", reset: "Password reset", support: "Triakshi support", api: "Mobile app" };

/** Filters on the Users list. */
export const SHOW_LABELS: Record<string, string> = {
  never: "Never signed in", noemail: "No email", unverified: "Email not verified", mustchange: "Must change password", custom: "Custom role", stale: "No sign-in for 60 days",
};
