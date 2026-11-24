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
