/**
 * Jobs owned by the platform itself (not by a school feature).
 * @module @smw/worker/platform-jobs
 */
import { services, type Mail } from "@smw/integrations";
import type { Logger } from "pino";
import type { JobMap } from "./registry";

/** Payload is a Mail. Sending twice is possible on retry; email is at-least-once by design. */
export const sendEmail = async (mail: Mail) => { await services().email.send(mail); };

// billing.lifecycle and domains.verify-pending come from the feature jobs.ts files, not from here.
export function platformJobs(_log: Logger): JobMap {
  return { "email.send": sendEmail };
}
