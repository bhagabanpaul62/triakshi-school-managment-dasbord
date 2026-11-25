// The first-day communication checklist. Each step ticks itself from the data; nothing is stored.
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";

export interface CommStep { key: string; label: string; text: string; href: string; done: boolean; feature: string }

const yes = async (tx: Tx, q: ReturnType<typeof sql>) => !!([...(await tx.execute(q))] as { ok: boolean }[])[0]?.ok;

export async function communicationSteps(tx: Tx, on: (feature: string) => boolean): Promise<CommStep[]> {
  const [email, quiet, lead, notice] = await Promise.all([
    on("notifications") ? yes(tx, sql`select exists (select 1 from comm_deliveries where channel = 'email' and state = 'sent') as ok`) : false,
    on("notifications") ? yes(tx, sql`select exists (select 1 from comm_settings) as ok`) : false,
    on("settings") ? yes(tx, sql`select exists (select 1 from users u join school_roles r on r.id = u.role_id where u.status = 'active' and 'messages:safeguard' = any(r.grants)) as ok`) : false,
    on("announcements") ? yes(tx, sql`select exists (select 1 from announcements where state = 'published') as ok`) : false,
  ]);
  return [
    { key: "email", label: "Check that email works", text: "Send a test and read the delivery health. Families miss notices if mail does not leave.", href: "/app/notifications/delivery", done: email, feature: "notifications" },
    { key: "quiet", label: "Look at quiet hours", text: "No push or email between 8 pm and 7 am and on Sundays, unless you change it.", href: "/app/settings/communication", done: quiet, feature: "notifications" },
    { key: "lead", label: "Name a safeguarding lead", text: "Give one trusted person a role with the safeguarding right, so concerns reach them and not only the principal.", href: "/app/settings/roles", done: lead, feature: "settings" },
    { key: "notice", label: "Send your first notice", text: "A short welcome to families is enough. You will see who has read it.", href: "/app/announcements/new", done: notice, feature: "announcements" },
  ].filter((s) => on(s.feature));
}
