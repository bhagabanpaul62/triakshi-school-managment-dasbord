import type { DnsResolver } from "@smw/integrations";
import { isApex } from "./hostname";

export interface VerifyResult { txtOk: boolean; cnameOk: boolean; ok: boolean; error?: string }

/** Checks the two DNS records that prove a school owns a domain and points it at us. */
export class DomainVerifier {
  constructor(private readonly dns: DnsResolver) {}

  async verify(hostname: string, token: string, rootDomain: string): Promise<VerifyResult> {
    const txtName = `_smw-verify.${hostname}`;
    const target = `sites.${rootDomain}`.toLowerCase();
    const [txt, cname] = await Promise.all([this.dns.txt(txtName), this.dns.cname(hostname)]);
    const txtOk = txt.some((t) => t.trim() === `smw-verify=${token}`);
    const cnameOk = cname.some((c) => c.replace(/\.$/, "").toLowerCase() === target);
    // A bare domain cannot hold a CNAME (the A record is not visible to this resolver), so proof of ownership is the TXT alone.
    const ok = txtOk && (cnameOk || isApex(hostname));
    const error = ok ? undefined
      : !txtOk ? `We could not find the TXT record ${txtName} with the right value yet.`
      : `The TXT record is right, but ${hostname} does not point to ${target} yet.`;
    return { txtOk, cnameOk, ok, error };
  }
}
