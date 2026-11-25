import { AppError, type Ctx } from "@smw/feature-kit";
import { EnquiryService } from "@smw/feature-website/service";
import { StudentService } from "@smw/feature-students/service";

/** Mark the enquiry. If this fails the student already exists, so the caller says so and offers a retry (marking is safe to repeat). */
async function mark(enq: EnquiryService, enquiryId: string, studentId: string, extra: Record<string, unknown> = {}) {
  try {
    await enq.markAdmitted(enquiryId, studentId);
    return { studentId, marked: true as const, ...extra };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "enquiry not marked after admission", enquiryId, studentId, err: String(err) }));
    return { studentId, marked: false as const, message: err instanceof AppError ? err.message : "Something went wrong.", ...extra };
  }
}

/**
 * Admit the child in steps: claim the enquiry (a second press is refused, and a student made by a run that crashed is found again), make the student,
 * write the student's id into the claim at once, then mark and link the enquiry. Never the other way round, so a student is never left without its link.
 * Sent again with `studentId` it only marks.
 */
export async function admitFromEnquiry(ctx: Ctx, enquiryId: string, studentId: string | undefined, input: Record<string, unknown>) {
  const enq = new EnquiryService(ctx);
  if (studentId) return mark(enq, enquiryId, studentId);
  const claim = await enq.startAdmission(enquiryId);
  if (claim.studentId) return mark(enq, enquiryId, claim.studentId);
  let made;
  try { made = await new StudentService(ctx).admit(input); } catch (err) { await enq.cancelAdmission(enquiryId, claim.token).catch(() => undefined); throw err; }
  await enq.saveClaimStudent(enquiryId, claim.token, made.student.id);
  return mark(enq, enquiryId, made.student.id, { capacityMessage: made.capacity.message });
}
