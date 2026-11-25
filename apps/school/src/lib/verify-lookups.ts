import { announcementsVerifyLookups } from "@smw/feature-announcements/verify";
import { feesVerifyLookups } from "@smw/feature-fees/verify";
import type { VerifyLookups } from "@smw/feature-finance/templates/verify";

/** One lookup per document kind that carries a QR code. */
export const VERIFY_LOOKUPS: VerifyLookups = { ...feesVerifyLookups, ...announcementsVerifyLookups };
