import { promises as dns } from "node:dns";

export interface DnsResolver {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
  /** IPv4 addresses the name resolves to (after any CNAME). */
  a(name: string): Promise<string[]>;
  /** Name servers of the zone the name sits in: walks up until it finds them. Used to tell which registrar runs the DNS. */
  ns(name: string): Promise<string[]>;
}

/** The resolver could not ask (SERVFAIL, timeout, no network). Never the same as "the record does not exist". */
export class DnsUnavailableError extends Error {
  constructor(name: string, readonly code?: string) { super(`Could not look up ${name}${code ? ` (${code})` : ""}`); }
}
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "NOTFOUND"]);
/** NXDOMAIN or NODATA is an answer ("nothing there"); anything else means we do not know. */
async function lookup<T>(name: string, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && NOT_FOUND.has(code)) return [];
    throw new DnsUnavailableError(name, code);
  }
}

const clean = (c: string) => c.replace(/\.$/, "").toLowerCase();

export class NodeDnsResolver implements DnsResolver {
  async txt(name: string) { return (await lookup(name, () => dns.resolveTxt(name))).map((r) => r.join("")); }
  async cname(name: string) { return (await lookup(name, () => dns.resolveCname(name))).map(clean); }
  async a(name: string) { return lookup(name, () => dns.resolve4(name)); }
  async ns(name: string) {
    const labels = name.toLowerCase().split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      try { const r = await dns.resolveNs(labels.slice(i).join(".")); if (r.length) return r.map(clean); } catch { /* try the parent */ }
    }
    return [];
  }
}

export class FakeDnsResolver implements DnsResolver {
  readonly records: { txt: Record<string, string[]>; cname: Record<string, string[]>; a: Record<string, string[]>; ns: Record<string, string[]> };
  /** Names whose lookups fail like a SERVFAIL or a timeout. */
  readonly down = new Set<string>();
  constructor(records: Partial<FakeDnsResolver["records"]> = {}) { this.records = { txt: {}, cname: {}, a: {}, ns: {}, ...records }; }
  private ask(name: string, from: Record<string, string[]>) { if (this.down.has(name)) throw new DnsUnavailableError(name, "ESERVFAIL"); return from[name] ?? []; }
  async txt(name: string) { return this.ask(name, this.records.txt); }
  async cname(name: string) { return this.ask(name, this.records.cname); }
  async a(name: string) { return this.ask(name, this.records.a); }
  async ns(name: string) { return this.records.ns[name] ?? []; }
}
