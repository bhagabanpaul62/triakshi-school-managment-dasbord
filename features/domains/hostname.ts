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
  z.object({ hostname: z.string().trim().min(1, "Enter your domain") }).transform((v, ctx) => {
    const r = checkHostname(v.hostname, rootDomain);
    if (!r.ok) { ctx.issues.push({ code: "custom", message: r.error, input: v.hostname, path: ["hostname"] }); return z.NEVER; }
    return { hostname: r.hostname };
  });

export interface DnsRecord { type: "TXT" | "CNAME" | "A"; name: string; value: string }
export interface DnsInstructions { records: DnsRecord[]; apex: boolean; notes: string[] }

/** The DNS records the school adds at its registrar. `sitesIp` is the server's fixed address (env SITES_IP) for bare domains. */
export function dnsInstructions(d: { hostname: string; verifyToken: string }, rootDomain: string, sitesIp: string): DnsInstructions {
  const apex = isApex(d.hostname);
  const records: DnsRecord[] = [{ type: "TXT", name: `_smw-verify.${d.hostname}`, value: `smw-verify=${d.verifyToken}` }];
  const notes = ["DNS changes can take from a few minutes up to a few hours to show up. We check every 10 minutes for 3 days."];
  if (apex) {
    records.push({ type: "A", name: d.hostname, value: sitesIp });
    notes.push(`A bare domain cannot use a CNAME, so point an A record to ${sitesIp}. Visitors to ${d.hostname} are sent on to www.${d.hostname}; also add www.${d.hostname} here and set it as your main domain.`);
  } else {
    records.push({ type: "CNAME", name: d.hostname, value: `sites.${rootDomain}` });
  }
  return { records, apex, notes };
}
