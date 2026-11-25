/** Who runs the school's DNS, told from the name servers of its domain. */
export type ProviderKey = "godaddy" | "hostinger" | "bigrock" | "namecheap" | "cloudflare" | "other";

const MATCH: [ProviderKey, RegExp][] = [
  ["godaddy", /domaincontrol\.com$|secureserver\.net$/],
  ["hostinger", /dns-parking\.com$|hostinger\.com$/],
  ["bigrock", /bigrock\.(in|com)$|\.bigrockdns\./],
  ["namecheap", /registrar-servers\.com$|namecheaphosting\.com$/],
  ["cloudflare", /\.ns\.cloudflare\.com$/],
];

export function detectProvider(nameServers: readonly string[]): ProviderKey {
  for (const [key, re] of MATCH) if (nameServers.some((n) => re.test(n.toLowerCase().replace(/\.$/, "")))) return key;
  return "other";
}

export interface ProviderGuide { name: string; where: string; steps: string[]; warning?: string }

const ADD = "Choose Add record, pick the type, and copy the name and value from this page.";
export const GUIDES: Record<ProviderKey, ProviderGuide> = {
  godaddy: { name: "GoDaddy", where: "Sign in to GoDaddy, open My Products, find the domain and press DNS.", steps: ["On the DNS page press Add New Record.", ADD, "In the Name box type the short name shown here. Type @ for the domain itself.", "Leave TTL as it is and press Save. Do this once for each record."] },
  hostinger: { name: "Hostinger", where: "Sign in to hPanel, open Domains, press Manage next to the domain, then DNS / Nameservers.", steps: ["Under DNS Records fill the form at the top: type, name, value.", "Type @ in Name for the domain itself.", "Press Add Record. Do this once for each record.", "If an old A or CNAME record already exists for the same name, delete it first."] },
  bigrock: { name: "BigRock", where: "Sign in to BigRock, open Manage Domains, choose the domain, then DNS Management.", steps: ["Open Manage DNS Records.", ADD, "Leave the Name box empty or type @ for the domain itself.", "Save each record. Changes can take up to a few hours here."] },
  namecheap: { name: "Namecheap", where: "Sign in to Namecheap, open Domain List, press Manage next to the domain, then Advanced DNS.", steps: ["Press Add New Record.", ADD, "In Host type the short name shown here. Type @ for the domain itself.", "Press the tick to save. Do this once for each record."] },
  cloudflare: { name: "Cloudflare", where: "Sign in to Cloudflare, choose the domain, open DNS, then Records.", steps: ["Press Add record.", ADD, "Switch the proxy off: the cloud next to the record must be grey and say DNS only.", "Press Save. Do this once for each record."], warning: "Turn the proxy off. An orange cloud hides our server address, so we cannot see that the domain points to us and the certificate cannot be issued." },
  other: { name: "your DNS provider", where: "Sign in where you manage the domain (the company you bought it from, or your IT person's DNS service) and open its DNS records page.", steps: ["Add a new record for each line below.", "Use the type, name and value shown here. Some providers want the full name, others the short one: try the short one first.", "Save, then come back and press Check now."] },
};

/** A message the school can send to whoever runs its DNS. Plain text, ready to paste. */
export function itNote(o: { school: string; hostname: string; records: { type: string; short: string; name: string; value: string }[]; provider: ProviderKey }): { subject: string; body: string } {
  const lines = o.records.map((r) => `${r.type}   name: ${r.short}   (full name: ${r.name})   value: ${r.value}`);
  return {
    subject: `DNS records for ${o.hostname}`,
    body: [
      "Hello,", "",
      `${o.school} is putting its website on ${o.hostname}. Please add these DNS records for the domain:`, "",
      ...lines, "",
      ...(o.provider === "cloudflare" ? ["The domain is on Cloudflare: please keep the proxy off (DNS only, grey cloud) for these records.", ""] : []),
      "Please do not add other records for this name. When it is done, tell us and we will check it.", "", "Thank you",
    ].join("\n"),
  };
}
