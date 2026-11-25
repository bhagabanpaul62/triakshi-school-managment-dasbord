// The shape of an audience. Client-safe: no database imports.
import { z } from "zod";

const withId = <const T extends string>(type: T) => z.object({ type: z.literal(type), id: z.uuid() });
export const audienceRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("everyone") }), z.object({ type: z.literal("families") }), z.object({ type: z.literal("staff") }),
  withId("class"), withId("section"), withId("house"), withId("route"), withId("stop"), withId("group"), withId("student"), withId("person"),
  /** Families of a section's students who take a subject. */
  z.object({ type: z.literal("subject"), id: z.uuid(), sectionId: z.uuid().optional() }),
  /** Staff by built-in role key or custom role id. */
  z.object({ type: z.literal("role"), id: z.string().max(60) }),
  /** Class teacher and subject teachers of a class or section. */
  z.object({ type: z.literal("teachers_of"), classId: z.uuid().optional(), sectionId: z.uuid().optional() }),
  /** Families with a fee due older than `days`. Finance roles only. */
  z.object({ type: z.literal("fee_overdue"), days: z.number().int().min(0).max(365) }),
]);
export type AudienceRule = z.infer<typeof audienceRule>;
export const audienceSchema = z.object({ include: z.array(audienceRule).min(1, "Choose who it is for").max(200), exclude: z.array(audienceRule).max(200).default([]) });
export type Audience = z.infer<typeof audienceSchema>;

/** A form sends the audience as one JSON field. */
export const audienceField = z.preprocess((v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } }, audienceSchema);
export const EVERYONE: Audience = { include: [{ type: "everyone" }], exclude: [] };
export const isEveryone = (a: Audience) => a.exclude.length === 0 && a.include.some((r) => r.type === "everyone");

/** One person an audience reaches. A student without a login has no userId: they are counted, listed and can answer on paper. */
export interface Reached { userId: string | null; studentId: string | null; name: string; label: string; sectionId: string | null }
/** The same person always has the same key: `s:<studentId>` or `u:<userId>`. */
export const personKey = (p: Pick<Reached, "userId" | "studentId">) => (p.studentId ? `s:${p.studentId}` : `u:${p.userId}`);
