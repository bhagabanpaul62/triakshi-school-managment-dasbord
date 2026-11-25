import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import tls from "node:tls";

export interface TlsResult { ok: boolean; issuer: string | null; expiresAt: Date | null; error?: string }
/** Reads the certificate a host presents on port 443. */
export interface TlsProbe { probe(host: string): Promise<TlsResult> }

/** Addresses that are never a school's public server: this host, private, shared, link-local, benchmarking, protocol and multicast ranges, and the IPv6 equivalents. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]!) : /^(::1?$|f[cd]|fe[89ab]|ff[0-9a-f]{2}:|::ffff:|64:ff9b:|100:)/.test(v) || v.startsWith("2001:db8");
  }
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

export class NodeTlsProbe implements TlsProbe {
  constructor(private readonly timeoutMs = 5000) {}

  async probe(host: string): Promise<TlsResult> {
    let ip: string;
    try {
      const found = await dns.lookup(host, { all: true, family: 4 });
      if (!found.length || found.some((f) => isPrivateAddress(f.address))) return { ok: false, issuer: null, expiresAt: null, error: "The address is not a public one." };
      ip = found[0]!.address; // connect to the checked address, so a second lookup cannot send us elsewhere
    } catch { return { ok: false, issuer: null, expiresAt: null, error: "The name does not resolve." }; }
    return new Promise((resolve) => {
      const done = (r: TlsResult) => { socket.destroy(); resolve(r); };
      const socket = tls.connect({ host: ip, port: 443, servername: host, rejectUnauthorized: false, timeout: this.timeoutMs }, () => {
        const c = socket.getPeerCertificate();
        if (!c || !c.valid_to) return done({ ok: false, issuer: null, expiresAt: null, error: "No certificate was presented." });
        const expiresAt = new Date(c.valid_to);
        const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const issuer = pick(c.issuer?.O) ?? pick(c.issuer?.CN) ?? null;
        done(socket.authorized && expiresAt.getTime() > Date.now() ? { ok: true, issuer, expiresAt } : { ok: false, issuer, expiresAt, error: expiresAt.getTime() <= Date.now() ? "The certificate has expired." : "The certificate is not valid for this name." });
      });
      socket.on("timeout", () => done({ ok: false, issuer: null, expiresAt: null, error: "No answer on HTTPS within 5 seconds." }));
      socket.on("error", () => done({ ok: false, issuer: null, expiresAt: null, error: "HTTPS did not answer." }));
    });
  }
}

export class FakeTlsProbe implements TlsProbe {
  constructor(readonly results: Record<string, TlsResult> = {}) {}
  async probe(host: string) { return this.results[host] ?? { ok: false, issuer: null, expiresAt: null, error: "HTTPS did not answer." }; }
}
