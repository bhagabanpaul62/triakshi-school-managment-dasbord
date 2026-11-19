import type { Tone } from "@smw/ui/widgets/WidgetPrimitives";

/** How roles, account states and modules read and look, shared by every settings screen. */
export const ROLE_LABELS: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher", student: "Student", parent: "Parent" };
export const ROLE_TONES: Record<string, Tone> = { admin: "info", accountant: "warning", teacher: "default", student: "default", parent: "default" };
export const STATUS_LABELS: Record<string, string> = { active: "Active", invited: "Invited", disabled: "Disabled" };
export const STATUS_TONES: Record<string, Tone> = { active: "success", invited: "warning", disabled: "danger" };

/** "fees" → "Fees", "student-docs" → "Student docs". */
export const moduleLabel = (key: string) => key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
