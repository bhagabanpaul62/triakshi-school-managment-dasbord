import { sql } from "drizzle-orm";
import { withSchool } from "@smw/db";
import { allows, type Ctx } from "@smw/feature-kit";

// shortcut: mirrors website:enquiries in features/website/feature.ts (a feature dependency would be circular); custom roles go by their grant.
const enquiriesRead = (ctx: Pick<Ctx, "role" | "features" | "grants">) => allows(ctx, { key: "website", permissions: { enquiries: ["admin", "accountant"] } }, "enquiries");

/** The enquiry this student came from, read raw (the website module may be off or never switched on). Null for anyone who may not read enquiries. */
export async function cameFromEnquiry(ctx: Pick<Ctx, "role" | "features" | "grants" | "schoolId">, studentId: string): Promise<{ id: string; ref: string | null } | null> {
  if (!enquiriesRead(ctx)) return null;
  return withSchool(ctx.schoolId, async (tx) => {
    const [t] = [...(await tx.execute(sql`select to_regclass('enquiries') as t`))] as { t: string | null }[];
    if (!t?.t) return null;
    const [r] = [...(await tx.execute(sql`select id, ref from enquiries where converted_student_id = ${studentId} and merged_into is null limit 1`))] as { id: string; ref: string | null }[];
    return r ?? null;
  });
}
