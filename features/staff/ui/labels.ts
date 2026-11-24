import type { Tone } from "@smw/ui/tone";

/** How roles and account states read and look, shared by the list and the record page. */
export const ROLE_LABELS: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher", staff: "Staff" };
export const ROLE_TONES: Record<string, Tone> = { admin: "info", accountant: "warning", teacher: "default", staff: "default" };
export const EMPLOYMENT_LABELS: Record<string, string> = { permanent: "Permanent", contract: "Contract", part_time: "Part-time", visiting: "Visiting" };
export const STATE_LABELS: Record<string, string> = { active: "Active", invited: "Invited", left: "Deactivated" };
export const STATE_TONES: Record<string, Tone> = { active: "success", invited: "warning", left: "default" };
