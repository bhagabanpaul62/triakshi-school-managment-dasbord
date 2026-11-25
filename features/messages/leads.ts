// Who hears about a reported concern. A person named in it never does.
import { and, eq, notInArray, sql } from "drizzle-orm";
import { schoolRoles, users, type Tx } from "@smw/db";

/** Safeguarding leads (custom role with messages:safeguard) not named in the report; with none, every admin not named; with none, nobody and the screen shows outside contacts. */
export async function leadIds(tx: Tx, named: string[]): Promise<string[]> {
  const skip = named.length ? notInArray(users.id, named) : undefined;
  const leads = await tx.select({ id: users.id }).from(users).innerJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
    .where(and(eq(users.status, "active"), sql`'messages:safeguard' = any(${schoolRoles.grants})`, skip));
  if (leads.length) return leads.map((l) => l.id);
  return (await tx.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), eq(users.role, "admin"), skip))).map((a) => a.id);
}

/** Is this person named in any report about this conversation? They never see the report and never open, export or learn of the review. */
export async function isNamed(tx: Tx, threadId: string, userId: string): Promise<boolean> {
  const [r] = [...(await tx.execute(sql`select exists (select 1 from message_reports where thread_id = ${threadId}::uuid and ${userId}::uuid = any(about_user_ids)) as named`))] as { named: boolean }[];
  return !!r?.named;
}

/** Everyone named in any report about this conversation. The audit log carries them so its screen can hide the entry from them. */
export async function namedIn(tx: Tx, threadId: string): Promise<string[]> {
  const rows = [...(await tx.execute(sql`select distinct unnest(about_user_ids)::text as id from message_reports where thread_id = ${threadId}::uuid`))] as { id: string }[];
  return rows.map((r) => r.id);
}

/** Is a report about this conversation still open (new or being looked at)? */
export async function hasOpenReport(tx: Tx, threadId: string): Promise<boolean> {
  const [r] = [...(await tx.execute(sql`select exists (select 1 from message_reports where thread_id = ${threadId}::uuid and state in ('new', 'reviewing')) as open`))] as { open: boolean }[];
  return !!r?.open;
}
