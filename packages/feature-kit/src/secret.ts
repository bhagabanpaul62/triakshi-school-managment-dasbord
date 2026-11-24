// Encrypts single values (PAN, bank account) at rest. Server only.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env, isLocal } from "@smw/config";

function key() {
  const k = env().DATA_KEY;
  if (!k && !isLocal()) throw new Error("Set DATA_KEY before storing payroll details.");
  return createHash("sha256").update(k ?? "local-only-data-key").digest();
}

/** AES-256-GCM, "v1.<iv>.<tag>.<text>". `scope` (the school id) is bound in, so a value copied to another school will not open. */
export function seal(plain: string, scope: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv).setAAD(Buffer.from(scope));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Throws when the value was changed, belongs to another scope or the key is different. */
export function unseal(sealed: string, scope: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable protected value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url")).setAAD(Buffer.from(scope)).setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** "XXXXXX1234" for screens and lists. */
export const mask = (v: string | null | undefined, keep = 4) => (v ? `${"X".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);
