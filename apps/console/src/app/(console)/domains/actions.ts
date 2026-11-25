"use server";

import { DomainAdminService } from "@smw/platform";
import { ConflictError } from "@smw/feature-kit";
import { DomainVerificationJob } from "@smw/feature-domains/service";
import { COULD_NOT_CHECK } from "@smw/feature-domains/monitor";
import { consoleAction, field } from "@/lib/console-action";

const result = (d: { status: string; health: string | null }) => ({ status: d.status, health: d.health });

/** Check the records and the certificate now. The check itself is the domains feature's; the platform service authorises and audits it. */
export async function checkDomain(fd: FormData) {
  return consoleAction(DomainAdminService, (s) => s.checkNow(field(fd, "id"), async (d, by) => {
    const saved = await new DomainVerificationJob().check(d, by);
    if (saved.checkError === COULD_NOT_CHECK) throw new ConflictError(COULD_NOT_CHECK);
    return result(saved);
  }), "Checked");
}

/** End a claim or stop a domain serving. The school is shown the reason and told. */
export async function releaseDomain(fd: FormData) {
  return consoleAction(DomainAdminService, (s) => s.release(field(fd, "id"), field(fd, "reason"), async (d, by) => result(await new DomainVerificationJob().release(d, field(fd, "reason").trim(), by))), "Domain released. The school has been told");
}

/** Lift a staff release: the school may press Check now again. */
export async function allowDomain(fd: FormData) {
  return consoleAction(DomainAdminService, (s) => s.allow(field(fd, "id")), "The school can check this domain again");
}
