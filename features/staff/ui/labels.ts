import type { Tone } from "@smw/ui/widgets/WidgetPrimitives";

/** How roles and account states read and look, shared by the list and the record page. */
export const ROLE_LABELS: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher" };
export const ROLE_TONES: Record<string, Tone> = { admin: "info", accountant: "warning", teacher: "default" };
export const STATE_LABELS: Record<string, string> = { active: "Active", invited: "Invited", left: "Deactivated" };
export const STATE_TONES: Record<string, Tone> = { active: "success", invited: "warning", left: "default" };
