import { promises as dns } from "node:dns";

export interface DnsResolver { txt(name: string): Promise<string[]>; cname(name: string): Promise<string[]> }

export class NodeDnsResolver implements DnsResolver {
  async txt(name: string) { try { return (await dns.resolveTxt(name)).map((r) => r.join("")); } catch { return []; } }
  async cname(name: string) { try { return (await dns.resolveCname(name)).map((c) => c.replace(/\.$/, "").toLowerCase()); } catch { return []; } }
}

export class FakeDnsResolver implements DnsResolver {
  constructor(readonly records: { txt: Record<string, string[]>; cname: Record<string, string[]> } = { txt: {}, cname: {} }) {}
  async txt(name: string) { return this.records.txt[name] ?? []; }
  async cname(name: string) { return this.records.cname[name] ?? []; }
}
