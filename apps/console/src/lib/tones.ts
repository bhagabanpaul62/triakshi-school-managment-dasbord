import type { Tone } from "@smw/ui/tone";

export const SCHOOL_TONES: Record<string, Tone> = { pending: "warning", rejected: "danger", trial: "info", active: "success", past_due: "warning", read_only: "warning", suspended: "danger", cancelled: "default" };
export const SCHOOL_LABELS: Record<string, string> = { pending: "Awaiting approval", rejected: "Rejected", trial: "Trial", active: "Active", past_due: "Past due", read_only: "Read-only", suspended: "Suspended", cancelled: "Cancelled" };
export const statusOptions = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export const TICKET_TONES: Record<string, Tone> = { open: "info", pending: "warning", resolved: "success", closed: "default" };
export const TICKET_LABELS: Record<string, string> = { open: "Open", pending: "Waiting on school", resolved: "Resolved", closed: "Closed" };
export const PRIORITY_TONES: Record<string, Tone> = { urgent: "danger", high: "warning" };

export const STAGE_TONES: Record<string, Tone> = { alpha: "danger", beta: "warning", ga: "success" };
export const STAGE_LABELS: Record<string, string> = { alpha: "Alpha", beta: "Beta", ga: "Live" };

export const DESIGN_TONES: Record<string, Tone> = { requested: "info", quoted: "warning", paid: "success", in_progress: "info", in_review: "warning", delivered: "success", cancelled: "default" };
export const DESIGN_LABELS: Record<string, string> = { requested: "Requested", quoted: "Quoted", paid: "Paid", in_progress: "In progress", in_review: "In review", delivered: "Delivered", cancelled: "Cancelled" };

export const DOMAIN_LABELS: Record<string, string> = { verified: "Verified", pending: "Checking", failed: "Failed" };
export const DOMAIN_TONES: Record<string, Tone> = { verified: "success", pending: "warning", failed: "danger" };
export const ROLE_LABELS: Record<string, string> = { owner: "Owner", support: "Support", sales: "Sales" };
