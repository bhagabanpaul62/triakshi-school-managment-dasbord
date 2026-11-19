import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ANNOUNCEMENT_AUDIENCES } from "./schema";

export const announcementInput = z.object({
  title: f.text(3, 160, "Give it a title"),
  body: f.text(1, 5000, "Write the announcement"),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).default("all"),
  classId: f.optId(),
  isPublic: f.bool(),
  pinned: f.bool(),
}).refine((v) => v.audience !== "class" || v.classId, { message: "Pick the class", path: ["classId"] });
