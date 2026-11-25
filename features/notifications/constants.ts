export const CHANNELS = ["push", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const EMAIL_MODES = ["off", "instant", "digest"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];
export const DELIVERY_STATES = ["pending", "sent", "failed", "skipped", "bounced"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
