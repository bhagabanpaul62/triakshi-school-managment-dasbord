import type { FeatureSeed } from "@smw/feature-kit";
import { and, eq, inArray, schools, withConsole, withSchool } from "@smw/db";
import { subjects } from "@smw/feature-academics/schema";
import { ExamService, GradeScaleService, MarksService } from "./service";

interface SeedStudent { id: string; classId: string; sectionId?: string | null }
interface SeedClass { id: string; grade: number }

// Small deterministic generator: the same demo school gets the same marks every time.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A student's ability (percent) for one exam: most land in the 55-80 band, about 1 in 20 is weak enough to fail papers. */
function ability(studentId: string, salt: string) {
  const r = rng(`${studentId}:${salt}`);
  return r() < 0.05 ? clamp(30 + 6 * normal(r), 12, 45) : clamp(68 + 14 * normal(r), 40, 98);
}

/** Demo exams: Unit Test 1 (published) and the Half-Yearly (published for greenvalley, marks still open for sunrise). */
const seed: FeatureSeed = async (ctx, state) => {
  const [school] = await withConsole((tx) => tx.select({ slug: schools.slug }).from(schools).where(eq(schools.id, ctx.schoolId)));
  const publishHalfYearly = school?.slug !== "sunrise";
  const yearId = String(state.yearId);
  const termId = (state.termIds as string[] | undefined)?.[0];
  const classes = (state.classes ?? []) as SeedClass[];
  // Only students placed in a section sit papers.
  const people = ((state.students ?? []) as SeedStudent[]).filter((s) => s.sectionId);
  const exams = new ExamService(ctx);
  const marks = new MarksService(ctx);
  await new GradeScaleService(ctx).ensureDefault();

  const create = async (name: string, kind: string, startsOn: string, endsOn: string, groups: { classes: SeedClass[]; max: number; pass: number }[]) => {
    const [first, ...rest] = groups.filter((g) => g.classes.length);
    const { exam } = await exams.createWithPapers({ yearId, termId, name, kind, startsOn, endsOn, classIds: first!.classes.map((c) => c.id), subjectIds: [], maxMarks: first!.max, passMarks: first!.pass });
    for (const g of rest) await exams.addPapers(exam.id, { classIds: g.classes.map((c) => c.id), subjectIds: [], maxMarks: g.max, passMarks: g.pass });
    await exams.transition({ id: exam.id, to: "scheduled" });
    await exams.transition({ id: exam.id, to: "marks_open" });
    return exam;
  };

  /** Every student's mark on every paper: a base ability plus a little per-subject noise, and about 2% absent. */
  const enterMarks = async (examId: string) => {
    for (const paper of (await exams.detail(examId)).papers) {
      const entries = people.filter((s) => s.classId === paper.classId).map((s) => {
        const r = rng(`${s.id}:${paper.id}`);
        if (r() < 0.02) return { studentId: s.id, marks: null, absent: true };
        const pct = clamp(ability(s.id, examId) + 8 * normal(r), 5, 100);
        return { studentId: s.id, marks: Math.round((pct / 100) * paper.maxMarks), absent: false };
      });
      if (entries.length) await marks.save({ paperId: paper.id, entries: JSON.stringify(entries) });
    }
  };

  /** Art and Physical Education grades for report cards. */
  const gradeCoScholastic = async (examId: string) => {
    const wanted = ((state.subjects ?? []) as { id: string }[]).map((s) => s.id);
    const areas = wanted.length ? await withSchool(ctx.schoolId, (tx) => tx.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.kind, "co_scholastic"), inArray(subjects.id, wanted)))) : [];
    const entries = people.flatMap((s) => areas.map((a) => {
      const u = rng(`${s.id}:${a.id}:co`)();
      return { studentId: s.id, subjectId: a.id, grade: u < 0.6 ? "A" : u < 0.9 ? "B" : "C" };
    }));
    if (entries.length) await marks.saveCoScholastic({ examId, entries: JSON.stringify(entries) });
  };

  const upper = classes.filter((c) => c.grade >= 6);
  const lower = classes.filter((c) => c.grade < 6);

  const unitTest = await create("Unit Test 1", "unit_test", "2026-07-20", "2026-07-24", [{ classes, max: 20, pass: 7 }]);
  await enterMarks(unitTest.id);
  await exams.transition({ id: unitTest.id, to: "published" });

  const halfYearly = await create("Half-Yearly Exam", "half_yearly", "2026-09-22", "2026-09-30", [{ classes: upper, max: 80, pass: 27 }, { classes: lower, max: 50, pass: 17 }]);
  await enterMarks(halfYearly.id);
  await gradeCoScholastic(halfYearly.id);
  if (publishHalfYearly) await exams.transition({ id: halfYearly.id, to: "published" });

  state.exams = [{ id: unitTest.id, name: unitTest.name }, { id: halfYearly.id, name: halfYearly.name }];
};
export default seed;
