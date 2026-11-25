/**
 * The visitor's address for the public forms. `X-Forwarded-For` is a list: each proxy adds the address it saw to the END, so the
 * first entry is whatever the visitor chose to send and cannot be trusted. Counting from the right, `hops` proxies of ours
 * (default 1: Caddy) wrote the entries, so the entry just left of them is the first one a visitor could not have made.
 * With one proxy that is the last entry. Login keeps its own older reading; only the public form uses this.
 */
export function trustedClientIp(h: Pick<Headers, "get">, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string | undefined {
  const list = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const n = Number.isInteger(hops) && hops >= 1 ? hops : 1;
  return list[Math.max(0, list.length - n)] || undefined;
}
