// A deletion request joins three things: the typed confirmation, the student's own erase rules, and closing the request.
// Two features (settings and students), so it lives here in the app.
import { ConflictError, ValidationError, type Ctx } from "@smw/feature-kit";
import { PrivacyService } from "@smw/feature-settings/privacy-service";
import { StudentService } from "@smw/feature-students/service";

/**
 * Checks the request is an open deletion request about this student, checks the typed admission number, erases, then closes the request.
 * If the closing fails after the erasing worked, asking again is safe: erasing a left student again changes nothing and the closing
 * of a request that is already done is not an error.
 */
export async function eraseStudentForRequest(ctx: Ctx, input: { studentId: string; requestId: string; confirm: string; reason: string }) {
  const privacy = new PrivacyService(ctx);
  const request = await privacy.get(input.requestId);
  if (request.kind !== "erasure" || request.subjectType !== "student" || request.subjectId !== input.studentId) throw new ValidationError({ confirm: "This student is not the one this request is about" });
  if (request.state === "done") return { already: true as const, blanked: [] as string[], guardians: 0 };
  if (request.state !== "open" && request.state !== "in_progress") throw new ConflictError("This request is closed. Nothing was erased.");
  const students = new StudentService(ctx);
  const preview = await students.erasePreview(input.studentId);
  if (input.confirm.trim() !== preview.admissionNo) throw new ValidationError({ confirm: `Type ${preview.admissionNo} exactly` });
  const done = await students.eraseOptional(input.studentId, input.reason);
  await privacy.finishErasure(input.requestId, `Blanked: ${done.blanked.join(", ")}${done.guardians ? `; contact details of ${done.guardians} guardian${done.guardians === 1 ? "" : "s"}` : ""}. Kept: name, admission number, marks, fees and transfer records.`);
  return { already: false as const, ...done };
}
