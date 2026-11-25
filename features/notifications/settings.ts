// School-wide communication rules. One row per school; every default lives in the schema below.
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { SchoolService, type Ctx } from "@smw/feature-kit";
import { EMAIL_MODES } from "./constants";
import notificationsFeature from "./feature";
import { commSettings } from "./schema";
import { TOPIC_GROUPS, type TopicGroup } from "./topics";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 20:00");
const format = (what: string) => z.string().trim().max(60).refine((s) => s.includes("{n}"), `${what} must contain {n}`);

const sideDefaults = z.partialRecord(z.enum(Object.keys(TOPIC_GROUPS) as [TopicGroup, ...TopicGroup[]]), z.object({ push: z.boolean(), email: z.enum(EMAIL_MODES) })).default({});

export const commSettingsSchema = z.object({
  quietFrom: time.default("20:00"),
  quietTo: time.default("07:00"),
  quietSundays: z.boolean().default(true),
  teacherPublish: z.enum(["free", "approval"]).default("free"),
  /** Applies to everyone except admins. */
  approvalFor: z.object({ families: z.boolean().default(false), wholeSchool: z.boolean().default(false), website: z.boolean().default(true) }).default({ families: false, wholeSchool: false, website: true }),
  familiesMayStart: z.boolean().default(true),
  familiesMayReply: z.boolean().default(true),
  teacherMessages: z.enum(["taught", "class_teacher"]).default("taught"),
  attachments: z.boolean().default(true),
  showStaffSeen: z.boolean().default(true),
  circularFormat: format("The circular number").default("CIR/{session}/{n}"),
  requestFormat: format("The request number").default("REQ/{session}/{n}"),
  /** Second languages a notice may be written in. */
  languages: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  /** What each group does for staff and for families until a person chooses. */
  channelDefaults: z.object({ staff: sideDefaults, families: sideDefaults }).default({ staff: {}, families: {} }),
  retentionYears: z.number().int().min(1).max(7).default(3),
  safetyContacts: z.array(z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().min(3).max(20) })).max(10).default([]),
  officeName: z.string().trim().min(1).max(60).default("School office"),
});
export type CommSettings = z.infer<typeof commSettingsSchema>;

/** The school's settings with every missing value filled. A damaged row falls back to the defaults, never an error. */
export async function loadCommSettings(tx: Tx): Promise<CommSettings> {
  const [row] = [...(await tx.execute(sql`select settings from comm_settings limit 1`))] as { settings: unknown }[];
  const parsed = commSettingsSchema.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : commSettingsSchema.parse({});
}

type Perm = keyof typeof notificationsFeature.permissions;

export class CommSettingsService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Any signed-in member of the school may read (families need the office name and safety contacts). */
  get(): Promise<CommSettings> { return this.read("read", loadCommSettings); }

  /** Takes the changed fields; the rest stay as they are. */
  async save(input: unknown): Promise<CommSettings> {
    this.authorize("manage", "write");
    return this.write("manage", async (tx) => {
      const next = this.parse(commSettingsSchema, { ...(await loadCommSettings(tx)), ...(input as object) });
      await tx.insert(commSettings).values({ schoolId: this.ctx.schoolId, settings: next })
        .onConflictDoUpdate({ target: commSettings.schoolId, set: { settings: next, updatedAt: new Date() } });
      return next;
    }, () => ({ action: "update", entity: "Communication settings", summary: "Changed communication settings" }));
  }
}
