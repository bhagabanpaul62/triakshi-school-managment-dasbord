import { DomainVerificationJob } from "./service";

/** Run by the worker every 10 minutes. */
export default {
  "domains.verify-pending": async () => new DomainVerificationJob().run(),
} satisfies Record<string, () => Promise<unknown>>;
