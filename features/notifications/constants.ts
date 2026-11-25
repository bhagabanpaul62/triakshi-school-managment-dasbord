export const CHANNELS = ["push", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const EMAIL_MODES = ["off", "instant", "digest"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];
export const DELIVERY_STATES = ["pending", "sent", "failed", "skipped", "bounced"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Postgres is happiest with at most this many ids in one `in (...)`. */
export const CHUNK = 1000;
export const chunks = <T>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
