import type { DomainRecordCheck } from "@smw/db";
import type { DnsResolver, TlsProbe } from "@smw/integrations";
import { isApex } from "./hostname";
import { detectProvider, type ProviderKey } from "./providers";

export interface VerifyResult {
  /** Each record on its own: txt, then cname (or a for a bare domain), then https. */
  records: DomainRecordCheck[];
  txtOk: boolean;
  /** The host points at us: CNAME to sites.<root> (or our address), or the A record for a bare domain. */
  pointsOk: boolean;
  httpsOk: boolean;
  /** Ownership and pointing both proven: enough to go Live. */
  ok: boolean;
  error?: string;
  certExpiresAt: Date | null;
  provider: ProviderKey;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Checks the records that prove a school owns a domain, point it at us and give it a certificate. */
export class DomainVerifier {
  constructor(private readonly dns: DnsResolver, private readonly tls: TlsProbe, private readonly sitesIp: string) {}

  async verify(hostname: string, token: string, rootDomain: string): Promise<VerifyResult> {
    const txtName = `_smw-verify.${hostname}`, apex = isApex(hostname);
    const target = `sites.${rootDomain}`.toLowerCase();
    const [txt, cname, a, ns] = await Promise.all([this.dns.txt(txtName), this.dns.cname(hostname), this.dns.a(hostname), this.dns.ns(hostname)]);
    const txtOk = txt.some((t) => t.trim() === `smw-verify=${token}`);
    const byAddress = a.includes(this.sitesIp);
    // A bare domain must have the A record (D5): a TXT alone proves ownership, not that the site is served from us.
    const pointsOk = apex ? byAddress : cname.some((c) => c.replace(/\.$/, "").toLowerCase() === target) || byAddress;

    // The certificate is only read once the name points at us: a probe of someone else's server says nothing about ours.
    const probe = pointsOk ? await this.tls.probe(hostname) : null;
    const httpsOk = !!probe?.ok;
    const records: DomainRecordCheck[] = [
      { key: "txt", ok: txtOk, expected: `smw-verify=${token}`, found: txt.filter((t) => t.startsWith("smw-verify=")), ...(txtOk ? {} : { note: txt.length ? "A record with another value is there." : "No record found yet." }) },
      apex
        ? { key: "a", ok: pointsOk, expected: this.sitesIp, found: a, ...(pointsOk ? {} : { note: a.length ? "The domain points somewhere else." : "No A record found yet." }) }
        : { key: "cname", ok: pointsOk, expected: target, found: cname.length ? cname : a, ...(pointsOk ? {} : { note: cname.length || a.length ? "The name points somewhere else." : "No CNAME record found yet." }) },
      {
        key: "https", ok: httpsOk, expected: "A valid certificate",
        found: probe?.expiresAt ? [probe.issuer ?? "Unknown issuer", `expires ${day(probe.expiresAt)}`] : [],
        note: !pointsOk ? "Checked once the address points to us." : httpsOk ? undefined : (probe?.error ?? "No certificate yet. It is issued on the first visit."),
      },
    ];
    const first = records.find((r) => !r.ok && r.key !== "https");
    const error = !first ? undefined
      : first.key === "txt" ? `We could not find the TXT record ${txtName} with the right value yet.`
      : apex ? `The TXT record is right, but ${hostname} has no A record pointing to ${this.sitesIp} yet.`
      : `The TXT record is right, but ${hostname} does not point to ${target} yet.`;
    return { records, txtOk, pointsOk, httpsOk, ok: txtOk && pointsOk, error, certExpiresAt: probe?.expiresAt ?? null, provider: detectProvider(ns) };
  }
}
