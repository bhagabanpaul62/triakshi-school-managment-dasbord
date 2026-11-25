import { DomainVerificationJob } from "./monitor";

export default {
  /** Every 10 minutes: claims waiting for DNS, and verified domains that are failing. */
  "domains.verify-pending": async () => new DomainVerificationJob().run(),
  /** Daily: every verified domain, once. */
  "domains.recheck": async () => new DomainVerificationJob().recheckAll(),
} satisfies Record<string, () => Promise<unknown>>;
