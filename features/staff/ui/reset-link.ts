import { Tokens } from "@smw/auth";
import { and, eq, inArray, oneTimeTokens, users, withSchool } from "@smw/db";

export type LinkState =
  | { ok: true; firstName: string; kind: "invite" | "reset" }
  | { ok: false; reason: "used" | "expired" | "unknown" };

/** Look at a set-password link without using it, so the page can say what is wrong before anyone types a password. */
export async function linkState(schoolId: string, token: string): Promise<LinkState> {
  return withSchool(schoolId, async (tx) => {
    const [row] = await tx.select({ purpose: oneTimeTokens.purpose, usedAt: oneTimeTokens.usedAt, expiresAt: oneTimeTokens.expiresAt, name: users.name })
      .from(oneTimeTokens).innerJoin(users, eq(users.id, oneTimeTokens.userId))
      .where(and(eq(oneTimeTokens.tokenHash, Tokens.hash(token)), inArray(oneTimeTokens.purpose, ["invite", "reset_password"]))).limit(1);
    if (!row) return { ok: false, reason: "unknown" } as const;
    if (row.usedAt) return { ok: false, reason: "used" } as const;
    if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" } as const;
    return { ok: true, firstName: row.name.split(/\s+/)[0] ?? row.name, kind: row.purpose === "invite" ? "invite" : "reset" } as const;
  });
}

/** The sign-in ID of a user, for signing them in right after they set a password. */
export async function loginIdOf(schoolId: string, userId: string): Promise<string | null> {
  return withSchool(schoolId, async (tx) => (await tx.select({ id: users.loginId }).from(users).where(eq(users.id, userId)).limit(1))[0]?.id ?? null);
}
