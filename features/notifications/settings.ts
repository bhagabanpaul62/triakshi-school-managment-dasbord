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
const format = (what: string) => z.string().trim().max(60).refine((s) => s.includes("{session}") && s.includes("{n}"), `${what} must contain {session} and {n}`);

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

const APPROVAL_DEFAULT = { families: false, wholeSchool: false, website: true };

/** The school's settings with every missing value filled. A damaged field falls back alone and the rest stay; a damaged approval switch becomes "approval needed". Never an error. */
export async function loadCommSettings(tx: Tx): Promise<CommSettings> {
  const [row] = [...(await tx.execute(sql`select settings from comm_settings limit 1`))] as { settings: unknown }[];
  const whole = commSettingsSchema.safeParse(row?.settings ?? {});
  if (whole.success) return whole.data;
  const raw = (row?.settings && typeof row.settings === "object" ? row.settings : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(commSettingsSchema.shape)) {
    if (field.safeParse(raw[key]).success) out[key] = raw[key];
    else if (key === "teacherPublish") out[key] = "approval";
    else if (key === "approvalFor") {
      const sw = raw[key] && typeof raw[key] === "object" ? (raw[key] as Record<string, unknown>) : null;
      out[key] = Object.fromEntries(Object.entries(APPROVAL_DEFAULT).map(([k, d]) => [k, !sw ? true : sw[k] === undefined ? d : typeof sw[k] === "boolean" ? sw[k] : true]));
    }
  }
  return commSettingsSchema.parse(out);
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
