import type { Tone } from "@smw/ui/tone";

export const HEALTH_LABELS: Record<string, string> = { ok: "Healthy", warning: "Needs a look", broken: "Broken" };
export const HEALTH_TONES: Record<string, Tone> = { ok: "success", warning: "warning", broken: "danger" };
