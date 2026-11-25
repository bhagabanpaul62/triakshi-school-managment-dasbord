import { z } from "zod";

/** Max custom domains per school. */
export const MAX_DOMAINS = 3;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// shortcut: a short list of two-part public suffixes common for Indian schools, not the full Public Suffix List; add entries as schools need them.
const TWO_PART_SUFFIXES = new Set(["co.in", "org.in", "net.in", "edu.in", "ac.in", "gov.in", "res.in", "firm.in", "gen.in", "ind.in", "com.au", "co.uk", "org.uk", "co.za", "com.sg"]);

/** Lower-case a hostname the user typed. Returns an error message, or the clean hostname. */
export function checkHostname(input: string, rootDomain: string): { ok: true; hostname: string } | { ok: false; error: string } {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: "Enter your domain, like www.myschool.in" };
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) return { ok: false, error: "Enter only the domain, without http:// or https://" };
  if (/[/?#\s@]/.test(raw)) return { ok: false, error: "Enter only the domain, without a path or spaces" };
  if (raw.includes(":")) return { ok: false, error: "Enter only the domain, without a port" };
  const host = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (host.length > 253) return { ok: false, error: "That domain is too long" };
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, error: "That does not look like a valid domain" };
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1]!)) return { ok: false, error: "That does not look like a valid domain" };
  const root = rootDomain.toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return { ok: false, error: `Domains under ${root} are already ours. Use your own domain` };
  return { ok: true, hostname: host };
}

/** True for a domain with no subdomain part: school.in, school.co.in. */
export function isApex(hostname: string): boolean {
  const labels = hostname.split(".");
  return labels.length <= 2 || (labels.length === 3 && TWO_PART_SUFFIXES.has(labels.slice(1).join(".")));
}

export const domainInput = (rootDomain: string) =>
  z.object({ hostname: z.string().trim().min(1, "Enter your domain"), pair: z.unknown().optional() }).transform((v, ctx) => {
    const r = checkHostname(v.hostname, rootDomain);
    if (!r.ok) { ctx.issues.push({ code: "custom", message: r.error, input: v.hostname, path: ["hostname"] }); return z.NEVER; }
    return { hostname: r.hostname, pair: v.pair === true || v.pair === "true" || v.pair === "on" };
  });

/** The part of a name the registrar's screen asks for: relative to the registered domain, "@" for the domain itself. */
export function shortName(fullName: string, hostname: string): string {
  const labels = hostname.split(".");
  const zone = labels.slice(-(TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2)).join(".");
  return fullName === zone ? "@" : fullName.endsWith(`.${zone}`) ? fullName.slice(0, -zone.length - 1) : fullName;
}

/** The www form of a bare domain and the bare form of a www one, or null when the name is neither. */
export function pairOf(hostname: string): string | null {
  if (isApex(hostname)) return `www.${hostname}`;
  return hostname.startsWith("www.") && isApex(hostname.slice(4)) ? hostname.slice(4) : null;
}

export interface DnsRecord { key: "txt" | "cname" | "a"; type: "TXT" | "CNAME" | "A"; name: string; short: string; value: string }
export interface DnsInstructions { records: DnsRecord[]; apex: boolean; notes: string[] }

/** The DNS records the school adds at its registrar. `sitesIp` is the server's fixed address (env SITES_IP) for bare domains. */
export function dnsInstructions(d: { hostname: string; verifyToken: string }, rootDomain: string, sitesIp: string): DnsInstructions {
  const apex = isApex(d.hostname);
  const txtName = `_smw-verify.${d.hostname}`;
  const records: DnsRecord[] = [{ key: "txt", type: "TXT", name: txtName, short: shortName(txtName, d.hostname), value: `smw-verify=${d.verifyToken}` }];
  const notes = ["DNS changes can take from a few minutes up to a few hours to show up. We check every 10 minutes for 3 days."];
  if (apex) {
    records.push({ key: "a", type: "A", name: d.hostname, short: "@", value: sitesIp });
    notes.push(`A bare domain cannot use a CNAME, so it points to ${sitesIp} with an A record. Add www.${d.hostname} too and make it your main domain: ${d.hostname} then sends visitors on to it.`);
  } else {
    records.push({ key: "cname", type: "CNAME", name: d.hostname, short: shortName(d.hostname, d.hostname), value: `sites.${rootDomain}` });
  }
  return { records, apex, notes };
}

/** The server's fixed address for bare domains (env SITES_IP). */
export const sitesIp = () => process.env.SITES_IP || "203.0.113.10";
